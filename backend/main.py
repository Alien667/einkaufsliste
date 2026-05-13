from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List

from . import crud, models, schemas, database

# Initialize database
models.Base.metadata.create_all(bind=database.engine)

app = FastAPI()

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency
def get_db():
    return crud.get_db() # Wait, I used get_db in database.py, I should import it

# Actually, I already have get_db in database.py. Let's import it correctly.
from .database import get_db

from typing import List
from pydantic import BaseModel

class ReorderAreas(BaseModel):
    area_ids: List[int]

# --- Area Endpoints ---

@app.get("/areas", response_model=List[schemas.Area])
def read_areas(db: Session = Depends(get_db)):
    return crud.get_areas(db)

@app.post("/areas", response_model=schemas.Area)
def create_area(area: schemas.AreaCreate, db: Session = Depends(get_db)):
    return crud.create_area(db, area)

@app.delete("/areas/{area_id}")
def delete_area(area_id: int, db: Session = Depends(get_db)):
    crud.delete_area(db, area_id)
    return {"message": "Area deleted"}

@app.patch("/areas/reorder")
def reorder_areas(reorder: ReorderAreas, db: Session = Depends(get_db)):
    crud.update_areas_order(db, reorder.area_ids)
    return {"message": "Areas reordered"}

@app.put("/areas/{area_id}", response_model=schemas.Area)
def update_area(area_id: int, area: schemas.AreaBase, db: Session = Depends(get_db)):
    return crud.update_area(db, area_id, area.name)

# --- Product Endpoints ---

@app.get("/products", response_model=List[schemas.Product])
def read_products(db: Session = Depends(get_db)):
    return crud.get_products(db)

@app.post("/products", response_model=schemas.Product)
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db)):
    return crud.create_product(db, product)

@app.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    crud.delete_product(db, product_id)
    return {"message": "Product deleted"}

@app.put("/products/{product_id}", response_model=schemas.Product)
def update_product(product_id: int, product: schemas.ProductCreate, db: Session = Depends(get_db)):
    return crud.update_product(db, product_id, product.name, product.area_id)

# --- Shopping Trip Endpoints ---

@app.post("/trips", response_model=schemas.ShoppingTrip)
def create_trip(db: Session = Depends(get_db)):
    return crud.create_trip(db)

@app.get("/trips", response_model=List[schemas.TripWithItems])
def read_trips(archived: bool = False, db: Session = Depends(get_db)):
    return crud.get_trips(db, archived=archived)

@app.get("/trips/{trip_id}", response_model=schemas.TripWithItems)
def read_trip(trip_id: int, db: Session = Depends(get_db)):
    trip = crud.get_trip(db, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip

@app.post("/trips/{trip_id}/archive")
def archive_trip(trip_id: int, db: Session = Depends(get_db)):
    crud.archive_trip(db, trip_id)
    return {"message": "Trip archived"}

# --- Shopping List Item Endpoints ---

@app.post("/items", response_model=schemas.ShoppingListItem)
def create_item(item: schemas.ShoppingListItemCreate, db: Session = Depends(get_db)):
    return crud.create_list_item(db, item)

@app.get("/items/trip/{trip_id}", response_model=List[schemas.ShoppingListItem])
def get_items_by_trip(trip_id: int, db: Session = Depends(get_db)):
    return crud.get_items_for_trip(db, trip_id)

@app.patch("/items/{item_id}/check")
def check_item(item_id: int, is_checked: bool, db: Session = Depends(get_db)):
    return crud.update_item_check(db, item_id, is_checked)

@app.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    crud.delete_item(db, item_id)
    return {"message": "Item deleted"}

# --- Special Endpoints for Page 3 (Selecting Products) ---

@app.get("/areas-with-products", response_model=List[schemas.AreaWithProducts])
def get_areas_with_products(db: Session = Depends(get_db)):
    # This is a bit hacky for the purpose of the frontend, 
    # but we can just return all areas and their products.
    areas = crud.get_areas(db)
    return areas

@app.get("/products-by-area/{area_id}", response_model=List[schemas.Product])
def get_products_by_area(area_id: int, db: Session = Depends(get_db)):
    # We can use the relationship in models.py
    from .models import Area
    area = db.query(Area).filter(Area.id == area_id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found")
    return area.products

@app.get("/all-products", response_model=List[schemas.Product])
def get_all_products(db: Session = Depends(get_db)):
    return crud.get_products(db)

@app.get("/all-areas", response_model=List[schemas.Area])
def get_all_areas(db: Session = Depends(get_db)):
    return crud.get_areas(db)
