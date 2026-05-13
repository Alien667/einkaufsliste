from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class Area(Base):
    __tablename__ = "areas"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    position = Column(Integer, default=0)

    products = relationship("Product", back_populates="area", cascade="all, delete-orphan")

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)

    area = relationship("Area", back_populates="products")

class ShoppingTrip(Base):
    __tablename__ = "shopping_trips"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_archived = Column(Boolean, default=False)

    items = relationship("ShoppingListItem", back_populates="trip", cascade="all, delete-orphan")

class ShoppingListItem(Base):
    __tablename__ = "shopping_list_items"

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey("shopping_trips.id"), nullable=False)
    name = Column(String, nullable=False)
    is_checked = Column(Boolean, default=False)
    
    # Links to product if it was from the master list
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    # Link to area (can be used for spontaneous items)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=True)

    trip = relationship("ShoppingTrip", back_populates="items")
    product = relationship("Product")
    area = relationship("Area")
