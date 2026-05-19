import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timedelta

from . import crud, models, schemas, database
from . import auth_database, auth_crud, auth_models, auth_schemas, security
from .email_service import email_service

# Load configuration
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:63342/einkaufsliste-git/frontend/index.html")

# Initialize database
models.Base.metadata.create_all(bind=database.engine)
auth_database.AuthBase.metadata.create_all(bind=auth_database.auth_engine)

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
    db = auth_database.AuthSessionLocal()
    try:
        yield db
    finally:
        db.close()

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
    return crud.create_area(db, area, current_user.account_id)

@app.delete("/areas/{area_id}")
def delete_area(
    area_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.delete_area(db, area_id, current_user.account_id)
    return {"message": "Area deleted"}

@app.patch("/areas/reorder")
def reorder_areas(
    reorder: schemas.ReorderAreas,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.update_areas_order(db, reorder.area_ids, current_user.account_id)
    return {"message": "Areas reordered"}

@app.put("/areas/{area_id}", response_model=schemas.Area)
def update_area(
    area_id: int,
    area: schemas.AreaBase,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.update_area(db, area_id, area.name, current_user.account_id)

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
    return crud.create_product(db, product, current_user.account_id)

@app.put("/products/{product_id}", response_model=schemas.Product)
def update_product(
    product_id: int,
    product_update: schemas.ProductUpdate,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Get existing product to handle partial updates
    from . import models
    db_product = db.query(models.Product).filter(models.Product.id == product_id, models.Product.account_id == current_user.account_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    name = product_update.name if product_update.name is not None else db_product.name
    area_id = product_update.area_id if product_update.area_id is not None else db_product.area_id

    product = crud.update_product(db, product_id, name, area_id, current_user.account_id)
    return product

@app.post("/trips", response_model=schemas.ShoppingTrip)
def create_trip(
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.create_trip(db, current_user.account_id)

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
    return {"message": "Trip archived"}

# --- Shopping List Item Endpoints ---

@app.post("/items", response_model=schemas.ShoppingListItem)
def create_item(
    item: schemas.ShoppingListItemCreate,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return crud.create_list_item(db, item, current_user.account_id)

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
    return crud.update_item_check(db, item_id, is_checked, current_user.account_id)

@app.delete("/items/{item_id}")
def delete_item(
    item_id: int,
    current_user: auth_models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    crud.delete_item(db, item_id, current_user.account_id)
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
