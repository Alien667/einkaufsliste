from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import List, Optional, Any
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
    updated_at: datetime

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

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    area_id: Optional[int] = None

class Product(ProductBase):
    id: int
    account_id: int
    updated_at: datetime

    class Config:
        from_attributes = True

# --- ShoppingTrip Schemas ---

class ShoppingTripBase(BaseModel):
    pass

class ShoppingTripCreate(ShoppingTripBase):
    pass

class TripSelectedProducts(BaseModel):
    selected_product_ids: List[int]

class ShoppingTrip(ShoppingTripBase):
    id: int
    created_at: datetime
    is_archived: bool
    account_id: int
    updated_at: Optional[datetime] = None
    selected_product_ids: Optional[List[int]] = None

    class Config:
        from_attributes = True

    @field_validator('selected_product_ids')
    @classmethod
    def convert_none_to_list(cls, v):
        if v is None:
            return []
        return v

# --- ShoppingListItem Schemas ---

class ShoppingListItemBase(BaseModel):
    name: str
    sort_order: int = 0
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
    updated_at: datetime

    class Config:
        from_attributes = True

# --- Combined Schemas for API responses ---

class TripWithItems(ShoppingTrip):
    items: List[ShoppingListItem]

class AreaWithProducts(Area):
    products: List[Product]

# --- Auth Schemas ---

from .auth_schemas import Token, TokenData, LoginRequest, UserResponse, UserCreate, Account
