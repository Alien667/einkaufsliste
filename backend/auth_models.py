from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from .auth_database import AuthBase

class Account(AuthBase):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)

    users = relationship("User", back_populates="account", cascade="all, delete-orphan")

class User(AuthBase):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

    account = relationship("Account", back_populates="users")

    @property
    def is_superuser(self) -> bool:
        return self.id == 1
