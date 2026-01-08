import express from 'express';
import { db, serverTimestamp, FieldValue } from '../firebase-admin.js';
import fetch from 'node-fetch';
import { Blob } from 'buffer';

const router = express.Router();
const PLATE_RECOGNIZER_API_KEY = process.env.PLATE_RECOGNIZER_API_KEY;

const findRegisteredVehicle = async (plateNumber) => {
    try {
        const usersSnapshot = await db.collection("users").get();
        const normalizedTarget = plateNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            const vehicles = userData.vehicles || [];
            const match = vehicles.find(v => (v.vehicleNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === normalizedTarget);
            if (match) {
                return { 
                    ownerId: userDoc.id, 
                    ownerName: userData.name || userData.ownerName, 
                    vehicle: match,
                    gpsStatus: userData.gpsStatus 
                };
            }
        }
    } catch (e) { console.error("Lookup Error:", e); }
    return null;
};

router.post('/sighting', async (req, res) => {
    const { base64Image, operator } = req.body;
    if (!operator || !base64Image) return res.status(400).json({ success: false, message: "Missing data." });

    try {
        // 1. Plate Recognition
        let imageBuffer = Buffer.from(base64Image, 'base64');
        const formData = new FormData();
        formData.append("upload", new Blob([imageBuffer], { type: 'image/jpeg' }), "frame.jpg");
        
        const prResponse = await fetch("https://api.platerecognizer.com/v1/plate-reader/", {
            method: "POST",
            headers: { "Authorization": `Token ${PLATE_RECOGNIZER_API_KEY}` },
            body: formData,
        });
        const prData = await prResponse.json();

        if (!prData.results || prData.results.length === 0) {
            return res.status(200).json({ success: false, message: "No plate detected." });
        }
        

        // 2. Cooldown Check (Prevents rapid-fire API hits from the same camera)
       // ... (Previous Plate Recognition code remains the same) ...
        const plateNumber = prData.results[0].plate.toUpperCase();

// 2. SERVER-SIDE COOLDOWN CHECK (0.05 Minutes / 3 Seconds)
        const COOLDOWN_MS = 0.05 * 60 * 1000; 
        const recentTripQuery = await db.collection("vehicle_trips")
            .where("plate", "==", plateNumber)
            .where("tollZoneId", "==", operator.tollZoneId)
            .orderBy("lastSightingTimestamp", "desc")
            .limit(1)
            .get();

        if (!recentTripQuery.empty) {
            const lastTrip = recentTripQuery.docs[0].data();
            // Safety check to ensure the timestamp is a valid Date object
            const lastTime = lastTrip.lastSightingTimestamp?.toDate 
                ? lastTrip.lastSightingTimestamp.toDate().getTime() 
                : 0;
            
            if (Date.now() - lastTime < COOLDOWN_MS) {
                return res.status(200).json({ 
                    success: true, 
                    message: "Duplicate ignored.", 
                    plate: plateNumber,
                    isDuplicate: true // Important for frontend UI handling
                });
            }
        }

// 3. Check for Active "In-Progress" Session (Journey Logic)
// ... (Rest of your code continues below) ...

        // 3. Check for Active "In-Progress" Session
        const activeTripQuery = await db.collection("vehicle_trips")
            .where("plate", "==", plateNumber)
            .where("status", "==", "in-progress")
            .where("tollZoneId", "==", operator.tollZoneId)
            .limit(1)
            .get();

        if (!activeTripQuery.empty) {
            const docId = activeTripQuery.docs[0].id;
            await db.collection("vehicle_trips").doc(docId).update({
                lastSightingTimestamp: serverTimestamp(),
                cameraCount: FieldValue.increment(1)
            });

            return res.status(200).json({ 
                success: true, 
                message: "Session updated. No charge yet.", 
                plate: plateNumber 
            });
        }

        // 4. Situation A Handling (GPS Priority)
        const registrationInfo = await findRegisteredVehicle(plateNumber);
        const isRegistered = Boolean(registrationInfo);

        // Use optional chaining (?.) to safely handle Situation C (unregistered)
        const isGpsActive = registrationInfo?.gpsStatus === 'Connected' || 
                            registrationInfo?.gpsStatus === 'Searching';

        // SITUATION A: GPS is active on a registered vehicle
        if (isRegistered && isGpsActive) {
            const bypassRecord = {
                plate: plateNumber,
                ownerName: registrationInfo.ownerName,
                status: `Bypassed (GPS ${registrationInfo.gpsStatus})`, 
                tollZoneId: operator.tollZoneId,
                tollZoneName: operator.tollZoneName,
                lastSightingTimestamp: serverTimestamp(),
                isRegistered: true,
                totalToll: 0 
            };

            await db.collection("vehicle_trips").add(bypassRecord);

            return res.status(200).json({ 
                success: true, 
                message: `GPS ${registrationInfo.gpsStatus}: Bypass applied.`, 
                plate: plateNumber,
                isRegistered: true,
                isDuplicate: false
            });
        }

        // 5. Start New Session (Situation B & C)
        const tripRecord = {
            plate: plateNumber,
            ownerId: registrationInfo?.ownerId || null,
            ownerName: registrationInfo?.ownerName || 'Unregistered',
            status: 'in-progress', 
            tollZoneId: operator.tollZoneId,
            tollZoneName: operator.tollZoneName,
            lastSightingTimestamp: serverTimestamp(),
            startTime: serverTimestamp(),
            isRegistered: isRegistered,
            totalToll: 150, 
            cameraCount: 1
        };

        await db.collection("vehicle_trips").add(tripRecord);

        return res.status(200).json({ 
            success: true, 
            message: "New session started. Charge pending exit.", 
            plate: plateNumber,
            isRegistered: isRegistered
        });

    } catch (error) {
        console.error("SERVER ERROR:", error.message);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
});

export default router;