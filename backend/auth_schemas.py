from pydantic import BaseModel, EmailStr, Field
from typing import Optional

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

class User(UserBase):
    id: int
    account_id: int

    class Config:
        from_attributes = True

class UserResponse(UserBase):
    id: int
    account_id: int
    is_superuser: bool = False

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
