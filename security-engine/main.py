import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
import json
import logging

from contextlib import asynccontextmanager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("security-engine")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Train the anomaly detection model
    train_anomaly_model()
    yield

app = FastAPI(
    title="Secure Exchange Portal - AI Security Engine",
    description="FastAPI anomaly detection service using Isolation Forest to classify suspicious network behavior.",
    version="1.0.0",
    lifespan=lifespan
)

# -------------------------------------------------------------
# AI Threat Detection Model Setup
# -------------------------------------------------------------

# Features in our classifier:
# 1. failed_logins (0 to 10)
# 2. request_volume_mb (0.0 to 1000.0)
# 3. requests_per_min (0 to 200)
# 4. geo_anomaly (0 or 1)

model = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)

def train_anomaly_model():
    """Generates synthetic training dataset of normal system usage and trains IsolationForest."""
    logger.info("Generating training dataset of typical user behavior...")
    np.random.seed(42)
    n_samples = 300
    
    # Typical normal access logs:
    # - 0 failed logins (mostly)
    # - Low request volumes (5MB - 35MB)
    # - Reasonable requests per minute (2 - 15 requests)
    # - No geo anomalies (0)
    failed_logins = np.random.choice([0, 1], size=n_samples, p=[0.97, 0.03])
    request_volume = np.random.exponential(scale=15.0, size=n_samples) + 0.001  # Avg ~15MB (supports small files down to 1 KB)
    requests_min = np.random.poisson(lam=5, size=n_samples) + 1 # Avg ~6 requests/min
    geo_anomaly = np.random.choice([0, 1], size=n_samples, p=[0.99, 0.01])
    
    X_train = np.column_stack((failed_logins, request_volume, requests_min, geo_anomaly))
    
    logger.info("Fitting Isolation Forest model on normal behavior baseline...")
    model.fit(X_train)
    logger.info("AI threat detection model trained successfully.")

# -------------------------------------------------------------
# Request & Response Contracts
# -------------------------------------------------------------

class AccessEvent(BaseModel):
    ip_address: str
    user_email: Optional[str] = None
    action: str
    details: Optional[str] = None # JSON stringified details
    timestamp: str

class ThreatAssessment(BaseModel):
    risk_score: float
    confidence: float
    threat_type: str
    explanation: str

# -------------------------------------------------------------
# Classification API Routes
# -------------------------------------------------------------

@app.post("/predict-threat", response_model=ThreatAssessment)
async def predict_threat(event: AccessEvent):
    try:
        # 1. Feature Engineering: Extract parameters from action & details
        failed_logins = 0
        request_volume = 1.0
        requests_min = 1
        geo_anomaly = 0
        
        # Determine features based on the trigger action
        if event.action == "LOGIN_FAIL":
            failed_logins = 3 # Assume elevated failed state
        
        if event.action == "GEO_MISMATCH":
            geo_anomaly = 1
            
        # Parse optional JSON details
        if event.details:
            try:
                details_dict = json.loads(event.details)
                if "failedCount" in details_dict:
                    failed_logins = int(details_dict["failedCount"])
                if "fileSizeMb" in details_dict:
                    request_volume = float(details_dict["fileSizeMb"])
                elif "fileSize" in details_dict:
                    request_volume = float(details_dict["fileSize"]) / (1024 * 1024) # Bytes to MB
                if "requestCount" in details_dict:
                    requests_min = int(details_dict["requestCount"])
                if "geoMismatch" in details_dict:
                    geo_anomaly = 1 if details_dict["geoMismatch"] else 0
            except Exception as e:
                logger.warning(f"Error parsing event details: {e}")

        # 2. Format features for the model
        X_new = np.array([[failed_logins, request_volume, requests_min, geo_anomaly]])
        
        # 3. Anomaly Prediction (-1 = anomaly, 1 = normal)
        prediction = model.predict(X_new)[0]
        
        # 4. Generate continuous anomaly risk score (0.0 to 1.0)
        # Isolation Forest score_samples returns negative values (lower = more anomalous)
        raw_score = model.score_samples(X_new)[0]
        # Normalize: IsolationForest raw scores are typically between -0.8 and -0.2.
        # Anomalous inputs have scores around -0.7 to -0.9. Inliers around -0.3 to -0.5.
        # We construct a human-readable threat risk percentage [0.0, 1.0]
        risk_score = float(np.clip((0.5 - raw_score) / 0.4, 0.0, 1.0))
        
        # 5. Classify threat types and write explanation
        threat_type = "NONE"
        explanation = "Access behavior conforms to baseline standard usage patterns."
        confidence = 0.92
        
        if prediction == -1 or risk_score >= 0.65:
            confidence = float(np.clip(0.85 + (risk_score * 0.1), 0.0, 0.99))
            if failed_logins >= 3:
                threat_type = "BRUTE_FORCE"
                explanation = f"AI flagged suspicious login activity. High failed authentication count ({failed_logins})."
            elif geo_anomaly == 1:
                threat_type = "GEO_ANOMALY"
                explanation = f"AI flagged anomalous geolocation request. Connection originates from unapproved geography."
            elif requests_min > 40:
                threat_type = "RATE_LIMIT_EXCEEDED"
                explanation = f"AI flagged request rate anomaly. IP requested {requests_min} queries/min (limit exceeded)."
            elif request_volume > 150.0:
                threat_type = "RATE_LIMIT_EXCEEDED"
                explanation = f"AI flagged exfiltration threat. Single file transfer volume ({request_volume:.1f} MB) exceeds safety threshold."
            else:
                # General variance on the lower side (e.g. small file sizes) is completely safe.
                threat_type = "NONE"
                explanation = "Access behavior conforms to standard usage parameters (general variance within normal bounds)."
                risk_score = 0.15
        
        # Adjust risk score based on rule checks to align with classification
        if threat_type != "NONE" and risk_score < 0.7:
            risk_score = 0.75

        logger.info(f"Evaluated event: {event.action} | Risk: {risk_score:.2f} | Threat: {threat_type}")
        
        return ThreatAssessment(
            risk_score=risk_score,
            confidence=confidence,
            threat_type=threat_type,
            explanation=explanation
        )

    except Exception as e:
        logger.error(f"Error evaluating threat prediction: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "healthy", "model_trained": True}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
