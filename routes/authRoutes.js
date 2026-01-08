import express from 'express';
import { db } from '../firebase-admin.js';
const router = express.Router();

// Helper to find operator (duplicated from zoneRoutes for circular dependency avoidance)
async function findOperator(cameraID, password) {
    const zonesSnapshot = await db.collection("tollZones").get();
    for (const zoneDoc of zonesSnapshot.docs) {
        const operators = zoneDoc.data().operators || {};
        const potentialOperator = operators[cameraID];
        if (potentialOperator) {
            if (potentialOperator.password === password) {
                return { zoneId: zoneDoc.id, operatorData: potentialOperator };
            }
        }
    }
    return null;
}

// POST /api/auth/login - Operator Login
router.post('/login', async (req, res) => {
    const { cameraID, password } = req.body;

    if (!cameraID || !password) {
        return res.status(400).json({ success: false, message: "Camera ID and password are required." });
    }

    try {
        const result = await findOperator(cameraID, password); 

        if (!result) {
             return res.status(401).json({ success: false, message: "Camera ID not found or incorrect password." });
        }
        
        const operatorData = result.operatorData;
        delete operatorData.password; // Remove sensitive data
        
        res.status(200).json({ 
            success: true, 
            message: `Login successful. Welcome ${cameraID}.`, 
            operator: operatorData 
        });

    } catch (e) {
        console.error("Login error:", e);
        res.status(500).json({ success: false, message: "Server error during login." });
    }
});

export default router;