import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
// IMPORTANT: Ensure you import these from your firebase-admin config file
import { db, serverTimestamp, FieldValue } from './firebase-admin.js'; 
import authRoutes from './routes/authRoutes.js';
import anprRoutes from './routes/anprRoutes.js';
import zoneRoutes from './routes/zoneRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOriginsEnv = process.env.CORS_ALLOWED_ORIGINS;
let corsMiddleware;

if (!allowedOriginsEnv || allowedOriginsEnv === '*') {
    corsMiddleware = cors(); 
} else {
    const allowedOrigins = allowedOriginsEnv
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);

    corsMiddleware = cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    });
}

// Middleware
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' })); 

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/anpr', anprRoutes);
app.use('/api/zones', zoneRoutes);

app.get('/', (req, res) => {
    res.send('ANPR Toll System API is running.');
});

// --- BACKGROUND PROCESSOR LOGIC ---

const processExitedVehicles = async () => {
    console.log("Checking for vehicles that exited the zone...");
    try {
        // 10 minutes of silence = Vehicle has exited the zone
        const EXIT_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);

        const expiredTrips = await db.collection("vehicle_trips")
            .where("status", "==", "in-progress")
            .where("lastSightingTimestamp", "<", EXIT_THRESHOLD)
            .get();

        if (expiredTrips.empty) return;

        for (const doc of expiredTrips.docs) {
    const trip = doc.data();
    
    // 1. HANDLE SITUATION C: Unregistered Vehicle
    if (!trip.ownerId) {
        await doc.ref.update({ status: "Invoice Pending" });
        console.log(`Unregistered vehicle ${trip.plate} finalized.`);
        continue;
    }

    // 2. HANDLE REGISTERED VEHICLES (A & B)
    const userDoc = await db.collection("users").doc(trip.ownerId).get();
    const userData = userDoc.data();

    // FINAL CHECK: Situation A - Did GPS reconnect or stay in 'Searching'?
    const isGpsActive = userData?.gpsStatus === 'Connected' || userData?.gpsStatus === 'Searching';

    if (userDoc.exists && isGpsActive) {
        await doc.ref.update({ 
            status: `Bypassed (GPS ${userData.gpsStatus})`, 
            totalToll: 0 
        });
        console.log(`Trip ${doc.id} bypassed: GPS ${userData.gpsStatus} at exit.`);
        continue;
    }

    // Situation B: GPS stayed offline. Charge once.
    try {
        const batch = db.batch();
        
        // Deduct from wallet
        batch.update(db.collection("users").doc(trip.ownerId), {
            walletBalance: FieldValue.increment(-trip.totalToll)
        });

        // Create transaction history
        const transactionRef = db.collection("transactions").doc();
        batch.set(transactionRef, {
            amount: trip.totalToll,
            description: `Toll Finalized - ${trip.tollZoneName} (ANPR Backup)`,
            timestamp: serverTimestamp(),
            type: "debit",
            userId: trip.ownerId,
            plate: trip.plate
        });

        // Mark trip as finished
        batch.update(doc.ref, { status: "completed" });
        
        await batch.commit();
        console.log(`Trip ${doc.id} finalized: Wallet deducted for ${trip.plate}.`);
    } catch (error) {
        console.error(`Failed to process payment for ${trip.plate}:`, error);
    }
}
    } catch (error) {
        console.error("Processor Error:", error.message);
    }
};

// Run exit check every 60 seconds
setInterval(processExitedVehicles, 60000);

// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
}); 