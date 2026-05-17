from sqlalchemy.orm import Session
from . import auth_models, auth_schemas

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

def create_user(db: Session, user: auth_schemas.UserCreate, hashed_password: str):
    db_user = auth_models.User(
        first_name=user.first_name,
        last_name=user.last_name,
        email=user.email,
        hashed_password=hashed_password,
        account_id=user.account_id
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
