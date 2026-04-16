from app.database import SessionLocal
from app.models import User

db = SessionLocal()
users = db.query(User).all()
for u in users:
    print(f"User: {u.username}, Role: {u.role}, Full Name: {u.full_name}")
db.close()
