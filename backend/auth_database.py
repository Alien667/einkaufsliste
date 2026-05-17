import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Get the directory of the current file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUTH_DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'auth.db')}"

auth_engine = create_engine(
    AUTH_DATABASE_URL, connect_args={"check_same_thread": False}
)
AuthSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=auth_engine)

AuthBase = declarative_base()

def get_auth_db():
    db = AuthSessionLocal()
    try:
        yield db
    finally:
        db.close()
