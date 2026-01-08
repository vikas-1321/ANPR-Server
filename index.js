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
 * Make sure the filename matches exactly what you typed in Render
 */
const serviceAccountPath = isProduction 
  ? '/etc/secrets/firebase-service-account.json' 
  : './your-local-key.json'; 

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
  }
}

export const db = admin.firestore();
// Use the modern firestore namespace for FieldValue in newer SDKs
export const FieldValue = admin.firestore.FieldValue;

// 2. MIDDLEWARE
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
            // ... your existing processing logic ...
            console.log(`Processing trip: ${doc.id}`);
        }
    } catch (error) {
        console.error("❌ Processor Error:", error.message);
    }
};

setInterval(processExitedVehicles, 60000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Server listening on port ${PORT}`);
});
