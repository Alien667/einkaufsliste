import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timedelta

from contextlib import asynccontextmanager
from sse_starlette.sse import ServerSentEvent
from starlette.responses import StreamingResponse
import json
import asyncio

from . import crud, models, schemas, database
from .auth_database import auth_engine, AuthBase, AuthSessionLocal
from . import auth_crud, auth_models, auth_schemas, security
from .email_service import email_service
from . import sse as sse_module

# Load configuration
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:63342/einkaufsliste-git/frontend/index.html")

# Initialize database (runs schema migrations automatically)
database.init_db()
AuthBase.metadata.create_all(bind=auth_engine)

app = FastAPI()

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security setup
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# Dependencies
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_auth_db():
    db = AuthSessionLocal()
    try:
        yield db
    finally:
        db.close();

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_auth_db)
) -> auth_models.User:
    credentials: auth_schemas.TokenData | None = None
    try:
        payload = security.jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        credentials = auth_schemas.TokenData(email=payload.get("sub"))
        if credentials is None or credentials.email is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    except security.JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")

    user = auth_crud.get_user_by_email(db, email=credentials.email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    return user

async def get_superuser(
    current_user: auth_models.User = Depends(get_current_user)
) -> auth_models.User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user does not have enough privileges"
        )
    return current_user

# --- Auth Endpoints ---

@app.post("/register", response_model=auth_schemas.UserResponse)
async def register(
    user_data: auth_schemas.UserEmailRegistration,
    db: Session = Depends(get_auth_db)
):
    # 1. Check if user already exists
    existing_user = auth_crud.get_user_by_email(db, user_data.email)
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 2. Check if any users exist to determine if this is the first user
    is_first_user = auth_crud.get_user_count(db) == 0

    # 3. Create Account
    account = auth_crud.create_account(db, auth_schemas.AccountCreate(name=f"Account_{user_data.email}"))

    # 4. Create Unverified User
    hashed_password = security.get_password_hash(user_data.password)

    user = auth_crud.create_unverified_user(db, user_data, hashed_password, account.id)

    # 5. Generate Verification Token
    token = security.create_verification_token({"email": user.email})
    expires = datetime.utcnow() + timedelta(minutes=security.VERIFICATION_TOKEN_EXPIRE_MINUTES)
    auth_crud.set_user_reset_token(db, user.id, token, expires)

    # 6. Send Email
    await email_service.send_verification_email(user.email, f"{FRONTEND_BASE_URL}?token={token}&type=verify")

    return user

@app.post("/auth/request-reset")
async def request_password_reset(
    request_data: auth_schemas.PasswordResetRequest,
    db: Session = Depends(get_auth_db)
):
    user = auth_crud.get_user_by_email(db, request_data.email)
    if not user:
        return {"message": "If the email is registered, a reset link has been sent."}

    token = security.create_verification_token({"email": user.email})
    expires = datetime.utcnow() + timedelta(minutes=security.VERIFICATION_TOKEN_EXPIRE_MINUTES)
    auth_crud.set_user_reset_token(db, user.id, token, expires)

    await email_service.send_password_reset_email(user.email, f"{FRONTEND_BASE_URL}?token={token}&type=reset")
    return {"message": "If the email is registered, a reset link has been sent."}

@app.post("/auth/verify-email")
def verify_email(
    token: str,
    db: Session = Depends(get_auth_db)
):
    user = auth_crud.get_user_by_reset_token(db, token)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    auth_crud.verify_user(db, user.id)
    return {"message": "Email verified successfully"}

@app.post("/auth/reset-password")
def reset_password(
    data: auth_schemas.PasswordResetVerify,
    db: Session = Depends(get_auth_db)
):
    user = auth_crud.get_user_by_reset_token(db, data.token)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    hashed_password = security.get_password_hash(data.new_password)
    auth_crud.update_password_after_reset(db, user.id, hashed_password)
    return {"message": "Password reset successfully"}
@app.post("/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_auth_db)
):
    user = auth_crud.get_user_by_email(db, email=form_data.username)
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email address before logging in."
        )

    access_token_expires = security.timedelta(minutes=security.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        data={"sub": user.email, "account_id": user.account_id},
        expires_delta=access_token_expires
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": auth_schemas.UserResponse.from_orm(user)
    }

@app.get("/admin/users", response_model=List[auth_schemas.UserResponse])
def read_all_users(
    superuser: auth_models.User = Depends(get_superuser),
    db: Session = Depends(get_auth_db)
):
    return auth_crud.get_all_users(db)

@app.get("/users", response_model=List[auth_schemas.UserResponse])
def read_users(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_auth_db)
):
    return auth_crud.get_users_by_account(db, current_user.account_id)

@app.post("/users", response_model=auth_schemas.UserResponse)
def create_user(
    user_data: auth_schemas.UserCreate,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_auth_db)
):
    hashed_password = security.get_password_hash(user_data.password)
    # Ensure we use the account_id of the current_user
    user_data.account_id = current_user.account_id
    return auth_crud.create_user(db, user_data, hashed_password)

@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_auth_db)
):
    success = auth_crud.delete_user(db, user_id, current_user.account_id)
    if not success:
        raise HTTPException(status_code=404, detail="User found but deletion failed or not authorized")
    return {"message": "User deleted"}

# --- Admin Account Endpoints ---

@app.get("/admin/accounts", response_model=List[auth_schemas.Account])
def read_all_accounts(
    superuser: auth_models.User = Depends(get_superuser),
    db: Session = Depends(get_auth_db)
):
    return auth_crud.get_all_accounts(db)

@app.post("/admin/accounts", response_model=auth_schemas.Account)
def create_account_admin(
    account_data: auth_schemas.AccountCreate,
    superuser: auth_models.User = Depends(get_superuser),
    db: Session = Depends(get_auth_db)
):
    return auth_crud.create_account(db, account_data)

@app.delete("/admin/accounts/{account_id}")
def delete_account_admin(
    account_id: int,
    superuser: auth_models.User = Depends(get_superuser),
    db: Session = Depends(get_auth_db)
):
    success = auth_crud.delete_account(db, account_id)
    if not success:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"message": "Account deleted"}

@app.patch("/admin/users/{user_id}/promote")
def promote_user_admin(
    user_id: int,
    superuser: auth_models.User = Depends(get_superuser),
    db: Session = Depends(get_auth_db)
):
    user = auth_crud.promote_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"User {user.email} promoted to superuser"}

# --- Area Endpoints ---

@app.get("/areas", response_model=List[schemas.Area])
def read_areas(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.get_areas(db, current_user.account_id)

@app.post("/areas", response_model=schemas.Area)
def create_area(
    area: schemas.AreaCreate,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_area = crud.create_area(db, area, current_user.account_id)
    _broadcast_change(current_user.account_id, "areas", db_area.id, "create", {
        "id": db_area.id, "name": db_area.name, "position": db_area.position,
        "account_id": db_area.account_id,
        "updated_at": db_area.updated_at.isoformat() if db_area.updated_at else None,
    })
    return db_area

@app.delete("/areas/{area_id}")
def delete_area(
    area_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.delete_area(db, area_id, current_user.account_id)
    _broadcast_change(current_user.account_id, "areas", area_id, "delete", None)
    return {"message": "Area deleted"}

@app.patch("/areas/reorder")
def reorder_areas(
    reorder: schemas.ReorderAreas,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.update_areas_order(db, reorder.area_ids, current_user.account_id)
    for area_id in reorder.area_ids:
        _broadcast_change(current_user.account_id, "areas", area_id, "patch", None)
    return {"message": "Areas reordered"}

@app.put("/areas/{area_id}", response_model=schemas.Area)
def update_area(
    area_id: int,
    area: schemas.AreaBase,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_area = crud.update_area(db, area_id, area.name, current_user.account_id)
    _broadcast_change(current_user.account_id, "areas", db_area.id, "patch", {
        "id": db_area.id, "name": db_area.name, "position": db_area.position,
        "account_id": db_area.account_id,
        "updated_at": db_area.updated_at.isoformat() if db_area.updated_at else None,
    })
    return db_area

# --- Product Endpoints ---

@app.get("/products", response_model=List[schemas.Product])
def read_products(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.get_products(db, current_user.account_id)

@app.post("/products", response_model=schemas.Product)
def create_product(
    product: schemas.ProductCreate,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_product = crud.create_product(db, product, current_user.account_id)
    _broadcast_change(current_user.account_id, "products", db_product.id, "create", {
        "id": db_product.id, "name": db_product.name, "area_id": db_product.area_id,
        "account_id": db_product.account_id,
        "updated_at": db_product.updated_at.isoformat() if db_product.updated_at else None,
    })
    return db_product

@app.put("/products/{product_id}", response_model=schemas.Product)
def update_product(
    product_id: int,
    product_update: schemas.ProductUpdate,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from . import models
    db_product = db.query(models.Product).filter(models.Product.id == product_id, models.Product.account_id == current_user.account_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    name = product_update.name if product_update.name is not None else db_product.name
    area_id = product_update.area_id if product_update.area_id is not None else db_product.area_id

    db_product = crud.update_product(db, product_id, name, area_id, current_user.account_id)
    _broadcast_change(current_user.account_id, "products", db_product.id, "patch", {
        "id": db_product.id, "name": db_product.name, "area_id": db_product.area_id,
        "account_id": db_product.account_id,
        "updated_at": db_product.updated_at.isoformat() if db_product.updated_at else None,
    })
    return db_product

@app.delete("/products/{product_id}")
def delete_product(
    product_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.delete_product(db, product_id, current_user.account_id)
    _broadcast_change(current_user.account_id, "products", product_id, "delete", None)
    return {"message": "Product deleted"}

@app.post("/trips", response_model=schemas.ShoppingTrip)
def create_trip(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_trip = crud.create_trip(db, current_user.account_id)
    _broadcast_change(current_user.account_id, "trips", db_trip.id, "create", {
        "id": db_trip.id,
        "created_at": db_trip.created_at.isoformat() if db_trip.created_at else None,
        "is_archived": db_trip.is_archived,
        "account_id": db_trip.account_id,
        "selected_product_ids": db_trip.selected_product_ids,
    })
    return db_trip

@app.get("/trips", response_model=List[schemas.TripWithItems])
def read_trips(
    archived: bool = False,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.get_trips(db, current_user.account_id, archived=archived)

@app.get("/trips/{trip_id}", response_model=schemas.TripWithItems)
def read_trip(
    trip_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    trip = crud.get_trip(db, trip_id, current_user.account_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip

@app.post("/trips/{trip_id}/archive")
def archive_trip(
    trip_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.archive_trip(db, trip_id, current_user.account_id)
    _broadcast_change(current_user.account_id, "trips", trip_id, "patch", {"is_archived": True})
    return {"message": "Trip archived"}

@app.put("/trips/{trip_id}/selected_products", response_model=schemas.ShoppingTrip)
def put_selected_products(
    trip_id: int,
    product_ids: schemas.TripSelectedProducts,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from datetime import datetime as dt
    db_trip = crud.update_selected_product_ids(
        db, trip_id, current_user.account_id, product_ids.selected_product_ids
    )
    db_trip.updated_at = dt.utcnow()
    _broadcast_change(current_user.account_id, "trips", trip_id, "patch", {
        "id": db_trip.id, "account_id": db_trip.account_id,
        "updated_at": db_trip.updated_at.isoformat(),
        "selected_product_ids": db_trip.selected_product_ids,
    })
    return db_trip

# --- Shopping List Item Endpoints ---

@app.post("/items", response_model=schemas.ShoppingListItem)
def create_item(
    item: schemas.ShoppingListItemCreate,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_item = crud.create_list_item(db, item, current_user.account_id)
    _broadcast_change(current_user.account_id, "items", db_item.id, "create", {
        "id": db_item.id, "trip_id": db_item.trip_id, "name": db_item.name,
        "sort_order": db_item.sort_order,
        "is_checked": db_item.is_checked, "product_id": db_item.product_id,
        "area_id": db_item.area_id, "account_id": db_item.account_id,
        "updated_at": db_item.updated_at.isoformat() if db_item.updated_at else None,
    })
    return db_item

@app.get("/items/trip/{trip_id}", response_model=List[schemas.ShoppingListItem])
def get_items_by_trip(
    trip_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.get_items_for_trip(db, trip_id, current_user.account_id)

@app.patch("/items/{item_id}/check")
def check_item(
    item_id: int,
    is_checked: bool,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db_item = crud.update_item_check(db, item_id, is_checked, current_user.account_id)
    _broadcast_change(current_user.account_id, "items", db_item.id, "patch", {
        "id": db_item.id, "trip_id": db_item.trip_id, "name": db_item.name,
        "sort_order": db_item.sort_order,
        "is_checked": db_item.is_checked, "product_id": db_item.product_id,
        "area_id": db_item.area_id, "account_id": db_item.account_id,
        "updated_at": db_item.updated_at.isoformat() if db_item.updated_at else None,
    })
    return db_item

@app.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.delete_item(db, item_id, current_user.account_id)
    _broadcast_change(current_user.account_id, "items", item_id, "delete", None)
    return {"message": "Item deleted"}

# --- Special Endpoints for Page 3 (Selecting Products) ---

@app.get("/areas-with-products", response_model=List[schemas.AreaWithProducts])
def get_areas_with_products(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    areas = crud.get_areas(db, current_user.account_id)
    return areas

@app.get("/products-by-area/{area_id}", response_model=List[schemas.Product])
def get_products_by_area(
    area_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from .models import Area
    area = db.query(Area).filter(Area.id == area_id, Area.account_id == current_user.account_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    return area.products

@app.get("/all-products", response_model=List[schemas.Product])
def get_all_products(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.get_products(db, current_user.account_id)

@app.get("/all-areas", response_model=List[schemas.Area])
def get_all_areas(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.get_areas(db, current_user.account_id)


# ==============================================================================
# SSE Sync Endpoint
# ==============================================================================

@app.get("/sync/stream")
async def sync_stream(
    token: str = "",
    auth_db: Session = Depends(get_auth_db),
):
    """
    SSE stream that sends real-time change notifications to the client.
    Authentication via JWT token (passed as query param: /sync/stream?token=...).
    """
    # Validate token from query param
    credentials: auth_schemas.TokenData | None = None
    try:
        payload = security.jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])
        credentials = auth_schemas.TokenData(email=payload.get("sub"))
        if credentials is None or credentials.email is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    except security.JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")

    user = auth_crud.get_user_by_email(auth_db, email=credentials.email)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")

    account_id = user.account_id
    queue = sse_module.register_client(account_id)

    async def event_stream():
        try:
            while True:
                try:
                    change = await asyncio.wait_for(queue.get(), timeout=30)
                    yield ServerSentEvent(
                        data=json.dumps(change, default=str),
                        event="sync_update",
                        id=str(change.get("timestamp", "")),
                    )
                except asyncio.TimeoutError:
                    # Send keepalive every 30s
                    yield ServerSentEvent(data="keepalive", event="ping")
        except asyncio.CancelledError:
            pass
        finally:
            sse_module.unregister_client(account_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _broadcast_change(account_id, entity_table, entity_id, operation, data):
    """Helper to broadcast a change (called after each write)."""
    sse_module.broadcast(account_id, entity_table, entity_id, operation, data)


# ==============================================================================
# Sync Endpoints
# ==============================================================================

@app.get("/sync/changes")
async def get_sync_changes(
    since: str = "",
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Liefert alle Entities, die sich seit `since` (ISO 8601 timestamp) geändert haben.
    """
    from datetime import datetime as dt
    import dateutil.parser

    try:
        since_dt = dateutil.parser.isoparse(since).replace(tzinfo=None) if since else None
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid 'since' timestamp format. Use ISO 8601.")

    account_id = current_user.account_id

    def filter_updated(model, since_dt):
        query = db.query(model).filter(model.account_id == account_id)
        if since_dt:
            query = query.filter(model.updated_at >= since_dt)
        return query.all()

    areas = filter_updated(models.Area, since_dt)
    products = filter_updated(models.Product, since_dt)
    items = filter_updated(models.ShoppingListItem, since_dt)
    trips = filter_updated(models.ShoppingTrip, since_dt)

    # Find max updated_at for the response timestamp
    max_dt = None
    for lst in [areas, products, items, trips]:
        for obj in lst:
            if obj.updated_at and (max_dt is None or obj.updated_at > max_dt):
                max_dt = obj.updated_at

    def _to_dict(obj, fields):
        """Serialize a SQLAlchemy model to dict with only specified fields."""
        return {f: getattr(obj, f) for f in fields}

    return {
        "timestamp": (max_dt or dt.utcnow()).isoformat(),
        "areas": [_to_dict(a, ["id", "account_id", "name", "position", "updated_at"]) for a in areas],
        "products": [_to_dict(p, ["id", "account_id", "name", "area_id", "updated_at"]) for p in products],
        "items": [_to_dict(i, ["id", "account_id", "trip_id", "name", "is_checked", "product_id", "area_id", "updated_at"]) for i in items],
        "trips": [_to_dict(t, ["id", "account_id", "is_archived", "updated_at", "selected_product_ids"]) for t in trips],
    }


@app.post("/sync/operations")
async def sync_operations(
    operations: dict,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Empfängt eine Batch-Liste lokaler Operationen und wendet sie auf den Server an.
    Gibt für jede Operation zurück, ob sie erfolgreich war oder ein Konflikt besteht.
    """
    from datetime import datetime as dt

    account_id = current_user.account_id
    now = dt.utcnow()

    op_list = operations.get("operations", [])
    results = []
    server_max_updated_at = now

    # Track which (entity, entity_id) have already been modified in this batch
    # to avoid conflicts from concurrent operations in the same sync
    modified_keys = {}

    for op in op_list:
        op_id = op.get("op_id")
        op_type = op.get("op_type")  # create, patch, delete
        entity = op.get("entity")  # area, product, item, trip
        entity_id = op.get("entity_id")
        data = op.get("data", {})

        if entity == "item":
            # --- CREATE item ---
            if op_type == "create":
                item_data = schemas.ShoppingListItemCreate(**data)
                new_item = crud.create_list_item(db, item_data, account_id)
                new_item.updated_at = now
                db.commit()
                db.refresh(new_item)
                _broadcast_change(account_id, "items", new_item.id, "create", _item_to_dict(new_item))
                results.append({
                    "op_id": op_id,
                    "status": "ok",
                    "server_id": new_item.id,
                    "server_updated_at": new_item.updated_at.isoformat()
                })

            # --- PATCH item ---
            elif op_type == "patch":
                # Conflict check
                existing = db.query(models.ShoppingListItem).filter(
                    models.ShoppingListItem.id == entity_id,
                    models.ShoppingListItem.account_id == account_id
                ).first()
                if existing:
                    # Check if server is newer than client
                    client_updated_at_str = data.get("_client_updated_at")
                    if client_updated_at_str and existing.updated_at:
                        try:
                            client_updated_at = dateutil.parser.isoparse(client_updated_at_str).replace(tzinfo=None)
                            if existing.updated_at > client_updated_at:
                                results.append({
                                    "op_id": op_id,
                                    "status": "conflict",
                                    "reason": "stale_update",
                                    "server_data": _item_to_dict(existing)
                                })
                                continue
                        except Exception:
                            pass

                    if "is_checked" in data:
                        existing.is_checked = data["is_checked"]
                    if "name" in data:
                        existing.name = data["name"]
                    existing.updated_at = now
                    db.commit()
                    db.refresh(existing)
                    _broadcast_change(account_id, "items", existing.id, "patch", _item_to_dict(existing))
                    results.append({
                        "op_id": op_id,
                        "status": "ok",
                        "server_updated_at": existing.updated_at.isoformat()
                    })
                else:
                    results.append({
                        "op_id": op_id,
                        "status": "not_found"
                    })

            # --- DELETE item ---
            elif op_type == "delete":
                existing = db.query(models.ShoppingListItem).filter(
                    models.ShoppingListItem.id == entity_id,
                    models.ShoppingListItem.account_id == account_id
                ).first()
                if existing:
                    db.delete(existing)
                    db.commit()
                    _broadcast_change(account_id, "items", entity_id, "delete", None)
                    results.append({
                        "op_id": op_id,
                        "status": "ok"
                    })
                else:
                    results.append({
                        "op_id": op_id,
                        "status": "already_deleted"
                    })

        elif entity == "area":
            if op_type == "create":
                area = crud.create_area(db, schemas.AreaCreate(**data), account_id)
                area.updated_at = now
                db.commit()
                db.refresh(area)
                _broadcast_change(account_id, "areas", area.id, "create", {
                    "id": area.id, "name": area.name, "account_id": area.account_id,
                    "updated_at": area.updated_at.isoformat()
                })
                results.append({
                    "op_id": op_id,
                    "status": "ok",
                    "server_id": area.id,
                    "server_updated_at": area.updated_at.isoformat()
                })
            elif op_type == "patch":
                existing = db.query(models.Area).filter(
                    models.Area.id == entity_id,
                    models.Area.account_id == account_id
                ).first()
                if existing:
                    # Conflict check
                    client_updated_at_str = data.get("_client_updated_at")
                    if client_updated_at_str and existing.updated_at:
                        try:
                            client_updated_at = dateutil.parser.isoparse(client_updated_at_str).replace(tzinfo=None)
                            if existing.updated_at > client_updated_at:
                                results.append({
                                    "op_id": op_id,
                                    "status": "conflict",
                                    "reason": "stale_update",
                                    "server_data": {
                                        "id": existing.id,
                                        "name": existing.name,
                                        "account_id": existing.account_id,
                                        "updated_at": existing.updated_at.isoformat()
                                    }
                                })
                                continue
                        except Exception:
                            pass

                    if "name" in data:
                        existing.name = data["name"]
                    existing.updated_at = now
                    db.commit()
                    db.refresh(existing)
                    _broadcast_change(account_id, "areas", existing.id, "patch", {
                        "id": existing.id, "name": existing.name, "account_id": existing.account_id,
                        "updated_at": existing.updated_at.isoformat()
                    })
                    results.append({
                        "op_id": op_id,
                        "status": "ok",
                        "server_updated_at": existing.updated_at.isoformat()
                    })
                else:
                    results.append({"op_id": op_id, "status": "not_found"})
            elif op_type == "delete":
                existing = crud.delete_area(db, entity_id, account_id)
                if existing:
                    _broadcast_change(account_id, "areas", entity_id, "delete", None)
                    results.append({"op_id": op_id, "status": "ok"})
                else:
                    results.append({"op_id": op_id, "status": "already_deleted"})

        elif entity == "product":
            if op_type == "create":
                product = crud.create_product(db, schemas.ProductCreate(**data), account_id)
                product.updated_at = now
                db.commit()
                db.refresh(product)
                _broadcast_change(account_id, "products", product.id, "create", {
                    "id": product.id, "name": product.name, "area_id": product.area_id,
                    "account_id": product.account_id,
                    "updated_at": product.updated_at.isoformat()
                })
                results.append({
                    "op_id": op_id,
                    "status": "ok",
                    "server_id": product.id,
                    "server_updated_at": product.updated_at.isoformat()
                })
            elif op_type == "patch":
                existing = db.query(models.Product).filter(
                    models.Product.id == entity_id,
                    models.Product.account_id == account_id
                ).first()
                if existing:
                    # Conflict check
                    client_updated_at_str = data.get("_client_updated_at")
                    if client_updated_at_str and existing.updated_at:
                        try:
                            client_updated_at = dateutil.parser.isoparse(client_updated_at_str).replace(tzinfo=None)
                            if existing.updated_at > client_updated_at:
                                results.append({
                                    "op_id": op_id,
                                    "status": "conflict",
                                    "reason": "stale_update",
                                    "server_data": {
                                        "id": existing.id,
                                        "name": existing.name,
                                        "area_id": existing.area_id,
                                        "account_id": existing.account_id,
                                        "updated_at": existing.updated_at.isoformat()
                                    }
                                })
                                continue
                        except Exception:
                            pass

                    if "name" in data:
                        existing.name = data["name"]
                    if "area_id" in data:
                        existing.area_id = data["area_id"]
                    existing.updated_at = now
                    db.commit()
                    db.refresh(existing)
                    _broadcast_change(account_id, "products", existing.id, "patch", {
                        "id": existing.id, "name": existing.name, "area_id": existing.area_id,
                        "account_id": existing.account_id,
                        "updated_at": existing.updated_at.isoformat()
                    })
                    results.append({
                        "op_id": op_id,
                        "status": "ok",
                        "server_updated_at": existing.updated_at.isoformat()
                    })
                else:
                    results.append({"op_id": op_id, "status": "not_found"})
            elif op_type == "delete":
                existing = crud.delete_product(db, entity_id, account_id)
                if existing:
                    _broadcast_change(account_id, "products", entity_id, "delete", None)
                    results.append({"op_id": op_id, "status": "ok"})
                else:
                    results.append({"op_id": op_id, "status": "already_deleted"})

        elif entity == "trip":
            if op_type == "create":
                trip = crud.create_trip(db, account_id)
                trip.updated_at = now
                db.commit()
                db.refresh(trip)
                _broadcast_change(account_id, "trips", trip.id, "create", {
                    "id": trip.id, "account_id": trip.account_id,
                    "updated_at": trip.updated_at.isoformat()
                })
                results.append({
                    "op_id": op_id,
                    "status": "ok",
                    "server_id": trip.id,
                    "server_updated_at": trip.updated_at.isoformat()
                })
            elif op_type == "patch":
                existing = db.query(models.ShoppingTrip).filter(
                    models.ShoppingTrip.id == entity_id,
                    models.ShoppingTrip.account_id == account_id
                ).first()
                if existing:
                    # Conflict check
                    client_updated_at_str = data.get("_client_updated_at")
                    if client_updated_at_str and existing.updated_at:
                        try:
                            client_updated_at = dateutil.parser.isoparse(client_updated_at_str).replace(tzinfo=None)
                            if existing.updated_at > client_updated_at:
                                results.append({
                                    "op_id": op_id,
                                    "status": "conflict",
                                    "reason": "stale_update",
                                    "server_data": {
                                        "id": existing.id,
                                        "account_id": existing.account_id,
                                        "is_archived": existing.is_archived,
                                        "selected_product_ids": existing.selected_product_ids,
                                        "updated_at": existing.updated_at.isoformat()
                                    }
                                })
                                continue
                        except Exception:
                            pass

                    if "is_archived" in data:
                        existing.is_archived = data["is_archived"]
                    if "selected_product_ids" in data:
                        existing.selected_product_ids = data["selected_product_ids"]
                    existing.updated_at = now
                    db.commit()
                    db.refresh(existing)
                    _broadcast_change(account_id, "trips", existing.id, "patch", {
                        "id": existing.id, "account_id": existing.account_id,
                        "updated_at": existing.updated_at.isoformat(),
                        "is_archived": existing.is_archived,
                        "selected_product_ids": existing.selected_product_ids,
                    })
                    results.append({
                        "op_id": op_id,
                        "status": "ok",
                        "server_updated_at": existing.updated_at.isoformat()
                    })
                else:
                    results.append({"op_id": op_id, "status": "not_found"})

    return {
        "server_timestamp": now.isoformat(),
        "results": results
    }


def _item_to_dict(item):
    d = {
        "id": item.id,
        "trip_id": item.trip_id,
        "name": item.name,
        "is_checked": item.is_checked,
        "product_id": item.product_id,
        "area_id": item.area_id,
        "account_id": item.account_id,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }
    return d
