"""Database seeding script – creates default admin and client users."""
from app.database import SessionLocal, engine
from app.models import Base, User, UserRole
from app.auth import hash_password


def run_migrations():
    """Run raw SQL migrations for changes that create_all cannot handle."""
    from sqlalchemy import text
    with engine.connect() as conn:
        # Add SUB_ADMIN to the userrole enum (Postgres enums are not auto-updated by create_all)
        try:
            conn.execute(text("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'SUB_ADMIN'"))
            conn.commit()
        except Exception as e:
            print(f"  Enum migration note: {e}")

        # Add created_by column to projects table if it doesn't exist
        try:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  Column migration note: {e}")

        # Add reviewer tracking columns
        try:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id)"
            ))
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP"
            ))
            conn.commit()
        except Exception as e:
            print(f"  Review column migration note: {e}")

        # Create client-sub-admin assignment table
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS client_sub_admin_assignments (
                    id UUID PRIMARY KEY,
                    client_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    sub_admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT uq_client_sub_admin_assignment UNIQUE (client_id, sub_admin_id)
                )
            """))
            conn.commit()
        except Exception as e:
            print(f"  Assignment table migration note: {e}")

        # Add plain_password column to users table
        try:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password VARCHAR(255)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  plain_password column migration note: {e}")

        # Add last_edited_by column to projects table
        try:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES users(id)"
            ))
            conn.commit()
        except Exception as e:
            print(f"  last_edited_by column migration note: {e}")

        # Backfill plain passwords for seeded users
        try:
            conn.execute(text("UPDATE users SET plain_password = 'admin123' WHERE username = 'admin' AND plain_password IS NULL"))
            conn.execute(text("UPDATE users SET plain_password = 'client123' WHERE username = 'client' AND plain_password IS NULL"))
            conn.execute(text("UPDATE users SET plain_password = 'subadmin123' WHERE username = 'subadmin' AND plain_password IS NULL"))
            conn.commit()
        except Exception as e:
            print(f"  Backfill plain_password note: {e}")


def seed():
    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Run migrations for enum/column changes
    run_migrations()

    db = SessionLocal()
    try:
        # Check if admin already exists
        existing_admin = db.query(User).filter(User.username == "admin").first()
        if not existing_admin:
            admin = User(
                username="admin",
                password_hash=hash_password("admin123"),
                plain_password="admin123",
                full_name="System Administrator",
                role=UserRole.ADMIN,
            )
            client = User(
                username="client",
                password_hash=hash_password("client123"),
                plain_password="client123",
                full_name="Demo Client",
                role=UserRole.CLIENT,
            )
            db.add_all([admin, client])
            db.commit()
            print("Database seeded successfully!")
            print("  Admin: admin / admin123")
            print("  Client: client / client123")
        else:
            print("Database already seeded.")

        # Seed sub-admin if not exists
        existing_subadmin = db.query(User).filter(User.username == "subadmin").first()
        if not existing_subadmin:
            subadmin = User(
                username="subadmin",
                password_hash=hash_password("subadmin123"),
                plain_password="subadmin123",
                full_name="Sub Administrator",
                role=UserRole.SUB_ADMIN,
            )
            db.add(subadmin)
            db.commit()
            print("  Sub-Admin seeded: subadmin / subadmin123")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
