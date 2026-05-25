from sqlalchemy.orm import Session, joinedload
from typing import List
from datetime import datetime, timedelta
from . import auth_models, auth_schemas, security, schemas

# --- Account CRUD ---

def create_account(db: Session, account: auth_schemas.AccountCreate):
    db_account = auth_models.Account(name=account.name)
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account

def get_all_accounts(db: Session):
    return db.query(auth_models.Account).all()

def get_account_by_id(db: Session, account_id: int):
    return db.query(auth_models.Account).filter(auth_models.Account.id == account_id).first()

def delete_account(db: Session, account_id: int):
    account = db.query(auth_models.Account).filter(auth_models.Account.id == account_id).first()
    if account:
        db.delete(account)
        db.commit()
        return True
    return False

# --- User CRUD ---

def create_user(db: Session, user: auth_schemas.UserCreate, hashed_password: str):
    db_user = auth_models.User(
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
        hashed_password=hashed_password,
        account_id=user.account_id,
        is_superuser=user.is_superuser,
        is_verified=True
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def create_unverified_user(db: Session, user: auth_schemas.UserEmailRegistration, hashed_password: str, account_id: int):
    """Creates a user that is not yet verified."""
    db_user = auth_models.User(
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
        hashed_password=hashed_password,
        account_id=account_id,
        is_verified=False
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def get_user_by_email(db: Session, email: str):
    return db.query(auth_models.User).filter(auth_models.User.email == email).first()

def get_users_by_account(db: Session, account_id: int):
    return db.query(auth_models.User).filter(auth_models.User.account_id == account_id).all()

def delete_user(db: Session, user_id: int, account_id: int):
    user = db.query(auth_models.User).filter(auth_models.User.id == user_id, auth_models.User.account_id == account_id).first()
    if user:
        db.delete(user)
        db.commit()
        return True
    return False

def promote_user(db: Session, user_id: int):
    user = db.query(auth_models.User).filter(auth_models.User.id == user_id).first()
    if user:
        user.is_superuser = True
        db.commit()
        db.refresh(user)
        return user
    return None

def get_user_count(db: Session):
    return db.query(auth_models.User).count()

def get_all_users(db: Session):
    return db.query(auth_models.User).all()

# --- Verification & Reset ---

def verify_user(db: Session, user_id: int):
    user = db.query(auth_models.User).filter(auth_models.User.id == user_id).first()
    if user:
        user.is_verified = True
        db.commit()
        db.refresh(user)
    return user

def set_user_reset_token(db: Session, user_id: int, token: str, expires: datetime):
    user = db.query(auth_models.User).filter(auth_models.User.id == user_id).first()
    if user:
        user.reset_token = token
        user.reset_token_expires = expires
        db.commit()
        db.refresh(user)
    return user

def get_user_by_reset_token(db: Session, token: str):
    return db.query(auth_models.User).filter(
        auth_models.User.reset_token == token,
        auth_models.User.reset_token_expires > datetime.utcnow()
    ).first()

def update_password_after_reset(db: Session, user_id: int, hashed_password: str):
    user = db.query(auth_models.User).filter(auth_models.User.id == user_id).first()
    if user:
        user.hashed_password = hashed_password
        user.reset_token = None
        user.reset_token_expires = None
        user.is_verified = True # Resetting password also verifies the user
        db.commit()
        db.refresh(user)
    return user

# --- ShoppingTrip CRUD ---

def create_trip(db: Session, account_id: int):
    from . import models
    db_trip = models.ShoppingTrip(account_id=account_id)
    db.add(db_trip)
    db.commit()
    db.refresh(db_trip)
    return db_trip

def get_trips(db: Session, account_id: int, archived: bool = False):
    from . import models
    query = db.query(models.ShoppingTrip).filter(models.ShoppingTrip.account_id == account_id, models.ShoppingTrip.is_archived == archived)
    query = query.options(joinedload(models.ShoppingTrip.items))
    return query.order_by(models.ShoppingTrip.created_at.desc()).all()

def get_trip(db: Session, trip_id: int, account_id: int):
    from . import models
    return db.query(models.ShoppingTrip).filter(models.ShoppingTrip.id == trip_id, models.ShoppingTrip.account_id == account_id).first()

def archive_trip(db: Session, trip_id: int, account_id: int):
    from . import models
    db_trip = db.query(models.ShoppingTrip).filter(models.ShoppingTrip.id == trip_id, models.ShoppingTrip.account_id == account_id).first()
    if db_trip:
        db_trip.is_archived = True
        db.commit()
    return db_trip

# --- ShoppingListItem CRUD ---

def create_list_item(db: Session, item: schemas.ShoppingListItemCreate, account_id: int):
    from . import models
    db_item = models.ShoppingListItem(**item.model_dump(), account_id=account_id)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def get_items_for_trip(db: Session, trip_id: int, account_id: int):
    from . import models
    return db.query(models.ShoppingListItem).filter(models.ShoppingListItem.trip_id == trip_id, models.ShoppingListItem.account_id == account_id).order_by(models.ShoppingListItem.sort_order).all()

def update_item_check(db: Session, item_id: int, is_checked: bool, account_id: int):
    from . import models
    db_item = db.query(models.ShoppingListItem).filter(models.ShoppingListItem.id == item_id, models.ShoppingListItem.account_id == account_id).first()
    if db_item:
        db_item.is_checked = is_checked
        db.commit()
        db.refresh(db_item)
    return db_item

def delete_item(db: Session, item_id: int, account_id: int):
    from . import models
    db_item = db.query(models.ShoppingListItem).filter(models.ShoppingListItem.id == item_id, models.ShoppingListItem.account_id == account_id).first()
    if db_item:
        db.delete(db_item)
        db.commit()
        db.refresh(db_item)
    return db_item
