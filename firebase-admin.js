import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore'; // 1. Added FieldValue here
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadServiceAccountFromEnv = () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        const potentialPath = raw.trim().replace(/^['"]|['"]$/g, '');
        const resolved = path.isAbsolute(potentialPath)
            ? potentialPath
            : path.resolve(__dirname, potentialPath);

        if (fs.existsSync(resolved)) {
            try {
                const fileContent = fs.readFileSync(resolved, 'utf-8');
                return JSON.parse(fileContent);
            } catch (fileError) {
                return null;
            }
        }
        return null;
    }
};

const loadServiceAccountFromFile = () => {
    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim() ||
        path.resolve(__dirname, 'serviceAccountKey.json');
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
};

const serviceAccount = loadServiceAccountFromEnv() || loadServiceAccountFromFile();

if (!serviceAccount) {
    console.error('No valid Firebase credentials found.');
    process.exit(1);
}

if (!admin?.apps?.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
}

export const db = getFirestore();

// 2. EXPORT THIS TO FIX THE INCREMENT ERROR
export { FieldValue }; 

export const serverTimestamp = FieldValue.serverTimestamp;
export default admin;