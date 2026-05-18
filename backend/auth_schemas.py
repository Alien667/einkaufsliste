from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime

# --- Account Schemas ---

class AccountBase(BaseModel):
    name: str

class AccountCreate(AccountBase):
    pass

class Account(AccountBase):
    id: int

    class Config:
        from_attributes = True

# --- User Schemas ---

class UserBase(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr

class UserCreate(UserBase):
    password: str = Field(..., max_length=72)
    account_id: Optional[int] = None
    is_superuser: Optional[bool] = False

class UserEmailRegistration(UserBase):
    """Schema for initial registration with name, email, and password."""
    password: str = Field(..., max_length=72)

class User(UserBase):
    id: int
    account_id: int
    is_superuser: bool
    is_verified: bool

    class Config:
        from_attributes = True

class UserResponse(UserBase):
    id: int
    account_id: int
    is_superuser: bool
    is_verified: bool

    class Config:
        from_attributes = True

# --- Auth Schemas ---

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None
    account_id: Optional[int] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class PasswordResetRequest(BaseModel):
    email: EmailStr

class PasswordResetVerify(BaseModel):
    token: str
    new_password: str = Field(..., max_length=72)
