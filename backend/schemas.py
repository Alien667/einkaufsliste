from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime

# --- Area Schemas ---

class AreaBase(BaseModel):
    name: str
    position: int = 0

class AreaCreate(AreaBase):
    pass

class Area(AreaBase):
    id: int
    account_id: int

    class Config:
        from_attributes = True

class ReorderAreas(BaseModel):
    area_ids: List[int]

# --- Product Schemas ---

class ProductBase(BaseModel):
    name: str
    area_id: int

class ProductCreate(ProductBase):
    pass

class Product(ProductBase):
    id: int
    account_id: int

    class Config:
        from_attributes = True

# --- ShoppingTrip Schemas ---

class ShoppingTripBase(BaseModel):
    pass

class ShoppingTripCreate(ShoppingTripBase):
    pass

class ShoppingTrip(ShoppingTripBase):
    id: int
    created_at: datetime
    is_archived: bool
    account_id: int

    class Config:
        from_attributes = True

# --- ShoppingListItem Schemas ---

class ShoppingListItemBase(BaseModel):
    name: str
    is_checked: bool = False
    product_id: Optional[int] = None
    area_id: Optional[int] = None

class ShoppingListItemCreate(ShoppingListItemBase):
    trip_id: int

class ShoppingListItem(ShoppingListItemBase):
    id: int
    trip_id: int
    product_id: Optional[int] = None
    area_id: Optional[int] = None
    account_id: int

    class Config:
        from_attributes = True

# --- Combined Schemas for API responses ---

class TripWithItems(ShoppingTrip):
    items: List[ShoppingListItem]

class AreaWithProducts(Area):
    products: List[Product]

# --- Auth Schemas ---

from .auth_schemas import Token, TokenData, LoginRequest, UserResponse, UserCreate, Account
