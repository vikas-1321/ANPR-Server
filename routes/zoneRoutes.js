import express from 'express';
import { db, serverTimestamp } from '../firebase-admin.js';

const router = express.Router();
const TOLL_ZONES_COLLECTION = 'tollZones';

// GET /api/zones - list all toll zones
router.get('/', async (_req, res) => {
    try {
        const snapshot = await db.collection(TOLL_ZONES_COLLECTION).get();
        const zones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, zones });
    } catch (error) {
        console.error('Failed to fetch zones:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch zones.' });
    }
});

// POST /api/zones - create a new toll zone
router.post('/', async (req, res) => {
    const { name, coordinates, center, max_distance, flat_rate } = req.body;

    if (!name || !Array.isArray(coordinates) || coordinates.length < 3 || !center) {
        return res.status(400).json({ 
            success: false, 
            message: 'Name, center and a polygon with at least 3 coordinates are required.' 
        });
    }

    try {
        const zonePayload = {
            name: name.trim(),
            coordinates,
            center,
            max_distance: parseFloat(max_distance) || 5000, // Store for fallback
            flat_rate: parseFloat(flat_rate) || 150,       // Store for fallback
            operators: {},
            operatorPathways: [],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        const docRef = await db.collection(TOLL_ZONES_COLLECTION).add(zonePayload);
        return res.status(201).json({ success: true, message: 'Toll zone created successfully.', id: docRef.id });
    } catch (error) {
        console.error('Failed to create zone:', error);
        return res.status(500).json({ success: false, message: 'Failed to create toll zone.' });
    }
});

// POST /api/zones/register - register a camera/operator inside a zone
router.post('/register', async (req, res) => {
    const { cameraID, password, cameraType, tollZoneId, tollZoneName, location } = req.body;

    if (!cameraID || !password || !tollZoneId || !location) {
        return res.status(400).json({ 
            success: false, 
            message: 'Camera ID, password, toll zone and location are required.' 
        });
    }

    const normalizedCameraId = cameraID.trim().toUpperCase();

    try {
        const zoneRef = db.collection(TOLL_ZONES_COLLECTION).doc(tollZoneId);
        const zoneDoc = await zoneRef.get();

        if (!zoneDoc.exists) {
            return res.status(404).json({ success: false, message: 'Toll zone not found.' });
        }

        const currentOperators = zoneDoc.data().operators || {};
        if (currentOperators[normalizedCameraId]) {
            return res.status(409).json({ success: false, message: 'Camera ID already registered in this zone.' });
        }

        const operatorPayload = {
            cameraID: normalizedCameraId,
            password,
            cameraType: cameraType || 'INTERMEDIATE',
            tollZoneId,
            tollZoneName: tollZoneName || zoneDoc.data().name,
            location,
            createdAt: serverTimestamp(),
        };

        await zoneRef.update({
            [`operators.${normalizedCameraId}`]: operatorPayload,
            updatedAt: serverTimestamp(),
        });

        return res.json({ success: true, message: `Camera ${normalizedCameraId} registered successfully.` });
    } catch (error) {
        console.error('Failed to register camera:', error);
        return res.status(500).json({ success: false, message: 'Failed to register camera.' });
    }
});

// PUT /api/zones/:zoneId/pathways - update operator pathways
router.put('/:zoneId/pathways', async (req, res) => {
    const { zoneId } = req.params;
    const { operatorPathways } = req.body;

    if (!Array.isArray(operatorPathways)) {
        return res.status(400).json({ success: false, message: 'operatorPathways must be an array.' });
    }

    const invalidPathway = operatorPathways.some(
        (entry) => !entry || !Array.isArray(entry.path) || entry.path.length < 2
    );
    if (invalidPathway) {
        return res.status(400).json({ success: false, message: 'Each pathway must include at least two camera IDs.' });
    }

    try {
        const zoneRef = db.collection(TOLL_ZONES_COLLECTION).doc(zoneId);
        const zoneDoc = await zoneRef.get();

        if (!zoneDoc.exists) {
            return res.status(404).json({ success: false, message: 'Toll zone not found.' });
        }

        await zoneRef.update({
            operatorPathways,
            updatedAt: serverTimestamp(),
        });

        return res.json({ success: true, message: 'Pathways updated successfully.' });
    } catch (error) {
        console.error('Failed to update pathways:', error);
        return res.status(500).json({ success: false, message: 'Failed to update pathways.' });
    }
});

export default router;
