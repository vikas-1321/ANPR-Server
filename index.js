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

/**
 * Render mounts Secret Files at /etc/secrets/<filename>
 */
const serviceAccountPath = isProduction 
  ? '/etc/secrets/firebase-service-account.json' 
  : './your-local-key.json'; 

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      // Explicitly setting the project ID helps resolve auth issues
      projectId: "toll-project-479605", 
      databaseURL: "https://toll-project-479605.firebaseio.com"
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
  }
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;

// 2. MIDDLEWARE CONFIGURATION
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 3. ROUTES
import authRoutes from './routes/authRoutes.js';
import anprRoutes from './routes/anprRoutes.js';
import zoneRoutes from './routes/zoneRoutes.js';

app.use('/api/auth', authRoutes);
app.use('/api/anpr', anprRoutes);
app.use('/api/zones', zoneRoutes);

app.get('/', (req, res) => {
    res.send('🚀 ANPR Toll System API is live and running.');
});

// 4. BACKGROUND PROCESSOR
const processExitedVehicles = async () => {
    try {
        const EXIT_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);
        const expiredTrips = await db.collection("vehicle_trips")
            .where("status", "==", "in-progress")
            .where("lastSightingTimestamp", "<", EXIT_THRESHOLD)
            .get();

        if (expiredTrips.empty) return;

        for (const doc of expiredTrips.docs) {
            const trip = doc.data();
            
            if (!trip.ownerId) {
                await doc.ref.update({ status: "Invoice Pending" });
                continue;
            }

            const userDoc = await db.collection("users").doc(trip.ownerId).get();
            const userData = userDoc.data();

            const isGpsActive = userData?.gpsStatus === 'Connected' || userData?.gpsStatus === 'Searching';
            if (isGpsActive) {
                await doc.ref.update({ 
                    status: `Bypassed (GPS ${userData.gpsStatus})`, 
                    totalToll: 0 
                });
                continue;
            }

            const batch = db.batch();
            batch.update(db.collection("users").doc(trip.ownerId), {
                walletBalance: admin.firestore.FieldValue.increment(-trip.totalToll)
            });

            const transRef = db.collection("transactions").doc();
            batch.set(transRef, {
                amount: trip.totalToll,
                description: `Toll: ${trip.tollZoneName} (ANPR Backup)`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: "debit",
                userId: trip.ownerId,
                plate: trip.plate
            });

            batch.update(doc.ref, { status: "completed" });
            await batch.commit();
        }
    } catch (error) {
        console.error("❌ Processor Error:", error.message);
    }
};

setInterval(processExitedVehicles, 60000);

// 5. SERVER START
app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Server listening on port ${PORT}`);
});
