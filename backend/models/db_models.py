import uuid
from sqlalchemy import Column, String, Text, JSON, DateTime
from sqlalchemy.sql import func
from database import Base


class CVDocument(Base):
    __tablename__ = "cv_documents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String(255), nullable=False)
    raw_text = Column(Text, nullable=False)
    structured_data = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
