from typing import List
from sqlalchemy.orm import Session, joinedload
from . import models, schemas

# --- Area CRUD ---

def get_areas(db: Session):
    return db.query(models.Area).order_by(models.Area.position).all()

def create_area(db: Session, area: schemas.AreaCreate):
    # Get the next position
    last_area = db.query(models.Area).order_by(models.Area.position.desc()).first()
    new_position = (last_area.position + 1) if last_area else 0

    db_area = models.Area(name=area.name, position=new_position)
    db.add(db_area)
    db.commit()
    db.refresh(db_area)
    return db_area

def delete_area(db: Session, area_id: int):
    db_area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if db_area:
        db.delete(db_area)
        db.commit()
    return db_area

def update_area(db: Session, area_id: int, name: str):
    db_area = db.query(models.Area).filter(models.Area.id == area_id).first()
    if db_area:
        db_area.name = name
        db.commit()
        db.refresh(db_area)
    return db_area

def update_product(db: Session, product_id: int, name: str, area_id: int):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if db_product:
        db_product.name = name
        db_product.area_id = area_id
        db.commit()
        db.refresh(db_product)
    return db_product

def update_areas_order(db: Session, area_ids: List[int]):
    for index, area_id in enumerate(area_ids):
        db.query(models.Area).filter(models.Area.id == area_id).update({"position": index})
    db.commit()

# --- Product CRUD ---

def get_products(db: Session):
    return db.query(models.Product).all()

def create_product(db: Session, product: schemas.ProductCreate):
    db_product = models.Product(**product.model_dump())
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    return db_product

def delete_product(db: Session, product_id: int):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if db_product:
        db.delete(db_product)
        db.commit()
    return db_product

# --- ShoppingTrip CRUD ---

def create_trip(db: Session):
    db_trip = models.ShoppingTrip()
    db.add(db_trip)
    db.commit()
    db.refresh(db_trip)
    return db_trip

def get_trips(db: Session, archived: bool = False):
    query = db.query(models.ShoppingTrip).filter(models.ShoppingTrip.is_archived == archived)
    query = query.options(joinedload(models.ShoppingTrip.items))
    return query.order_by(models.ShoppingTrip.created_at.desc()).all()

def get_trip(db: Session, trip_id: int):
    return db.query(models.ShoppingTrip).filter(models.ShoppingTrip.id == trip_id).first()

def archive_trip(db: Session, trip_id: int):
    db_trip = db.query(models.ShoppingTrip).filter(models.ShoppingTrip.id == trip_id).first()
    if db_trip:
        db_trip.is_archived = True
        db.commit()
    return db_trip

# --- ShoppingListItem CRUD ---

def create_list_item(db: Session, item: schemas.ShoppingListItemCreate):
    db_item = models.ShoppingListItem(**item.model_dump())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def get_items_for_trip(db: Session, trip_id: int):
    return db.query(models.ShoppingListItem).filter(models.ShoppingListItem.trip_id == trip_id).all()

def update_item_check(db: Session, item_id: int, is_checked: bool):
    db_item = db.query(models.ShoppingListItem).filter(models.ShoppingListItem.id == item_id).first()
    if db_item:
        db_item.is_checked = is_checked
        db.commit()
        db.refresh(db_item)
    return db_item

def delete_item(db: Session, item_id: int):
    db_item = db.query(models.ShoppingListItem).filter(models.ShoppingListItem.id == item_id).first()
    if db_item:
        db.delete(db_item)
        db.commit()
    return db_item
