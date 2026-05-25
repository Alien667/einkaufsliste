import os
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Get the directory of the current file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SQLALCHEMY_DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'shopping_list.db')}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def init_db():
    """Initialise tables and run schema migrations."""
    Base.metadata.create_all(bind=engine)
    _migrate_updated_at()
    _migrate_sort_order()


def _migrate_updated_at():
    """Add `updated_at` columns to areas, products, shopping_list_items if missing."""
    session = SessionLocal()
    try:
        tables = ["areas", "products", "shopping_list_items"]
        for table in tables:
            # Check if column already exists
            row = session.execute(
                text("PRAGMA table_info({})".format(table))
            ).fetchone()
            col_names = [r[1] for r in session.execute(
                text("PRAGMA table_info({})".format(table))
            ).fetchall()]

            if "updated_at" not in col_names:
                # Add the column
                session.execute(
                    text("ALTER TABLE {} ADD COLUMN updated_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00'".format(table))
                )
                # Set default for existing rows: use a fixed past date
                # so that any future server-side change is newer
                session.execute(
                    text("UPDATE {} SET updated_at = '1970-01-01 00:00:00' WHERE updated_at IS NULL OR updated_at = 0".format(table))
                )
                session.commit()
    finally:
        session.close()


def _migrate_sort_order():
    """Add `sort_order` column to shopping_list_items if missing."""
    session = SessionLocal()
    try:
        table = "shopping_list_items"
        col_names = [r[1] for r in session.execute(
            text("PRAGMA table_info({})".format(table))
        ).fetchall()]

        if "sort_order" not in col_names:
            session.execute(
                text("ALTER TABLE {} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0".format(table))
            )
            session.commit()
    finally:
        session.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
