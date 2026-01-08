import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

// Load Environment Variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// 1. FIREBASE ADMIN INITIALIZATION
const isProduction = process.env.RENDER === 'true';
const serviceAccountPath = isProduction 
  ? '/etc/secrets/firebase-service-account.json' // Path for Render Secret File
  : './your-local-key.json';                  // Path for your local machine

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath)
  });
  console.log('✅ Firebase Admin initialized successfully');
}

// Export database and helpers for use in other route files
export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;

// 2. MIDDLEWARE CONFIGURATION
const cors = require('cors');

// This allows all origins (e.g., your Firebase URL) to access your API
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 3. ROUTES
// Replace these with your actual route file imports
import authRoutes from './routes/authRoutes.js';
import anprRoutes from './routes/anprRoutes.js';
import zoneRoutes from './routes/zoneRoutes.js';

app.use('/api/auth', authRoutes);
app.use('/api/anpr', anprRoutes);
app.use('/api/zones', zoneRoutes);

app.get('/', (req, res) => {
    res.send('🚀 ANPR Toll System API is live and running.');
});

// 4. BACKGROUND PROCESSOR (Situations A, B, & C)
const processExitedVehicles = async () => {
    console.log("⏱️  Checking for vehicles that exited the zone...");
    try {
        // Threshold: 10 minutes of inactivity = Exit
        const EXIT_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);

        const expiredTrips = await db.collection("vehicle_trips")
            .where("status", "==", "in-progress")
            .where("lastSightingTimestamp", "<", EXIT_THRESHOLD)
            .get();

        if (expiredTrips.empty) {
            console.log("No expired trips found.");
            return;
        }

        for (const doc of expiredTrips.docs) {
            const trip = doc.data();
            
            // SITUATION C: Unregistered Vehicle (No ownerId)
            if (!trip.ownerId) {
                await doc.ref.update({ status: "Invoice Pending" });
                console.log(`📋 Unregistered: ${trip.plate} marked as Invoice Pending.`);
                continue;
            }

            // REGISTERED VEHICLES (A & B)
            const userDoc = await db.collection("users").doc(trip.ownerId).get();
            const userData = userDoc.data();

            // SITUATION A: GPS is active/searching (Bypass)
            const isGpsActive = userData?.gpsStatus === 'Connected' || userData?.gpsStatus === 'Searching';
            if (isGpsActive) {
                await doc.ref.update({ 
                    status: `Bypassed (GPS ${userData.gpsStatus})`, 
                    totalToll: 0 
                });
                console.log(`✅ Bypassed: ${trip.plate} (GPS was ${userData.gpsStatus}).`);
                continue;
            }

            // SITUATION B: GPS Offline (Deduct Wallet)
            try {
                const batch = db.batch();
                
                // Deduct balance
                batch.update(db.collection("users").doc(trip.ownerId), {
                    walletBalance: FieldValue.increment(-trip.totalToll)
                });

                // Record Transaction
                const transRef = db.collection("transactions").doc();
                batch.set(transRef, {
                    amount: trip.totalToll,
                    description: `Toll: ${trip.tollZoneName} (ANPR Backup)`,
                    timestamp: serverTimestamp(),
                    type: "debit",
                    userId: trip.ownerId,
                    plate: trip.plate
                });

                // Complete Trip
                batch.update(doc.ref, { status: "completed" });
                
                await batch.commit();
                console.log(`💰 Finalized: Wallet deducted for ${trip.plate}.`);
            } catch (payError) {
                console.error(`Payment failed for ${trip.plate}:`, payError);
            }
        }
    } catch (error) {
        console.error("❌ Processor Error:", error.message);
    }
};

// Start the 60-second background timer
setInterval(processExitedVehicles, 60000);

// 5. SERVER START
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Server listening on port ${PORT}`);
});