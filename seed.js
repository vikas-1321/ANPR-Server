// backend/seed.js
import { db } from './firebase-admin.js';

const seedData = async () => {
  try {
    console.log("Starting data initialization...");

    // 1. Create a Test User (Required for ANPR charging)
    // Document ID should match the plate number or a unique ID
    const testUser = {
      ownerName: "John Doe",
      vehicleModel: "Tesla Model 3",
      vehicleType: "car",
      walletBalance: 5000.00, // Initial balance for testing
      isRegistered: true
    };
    
    // Replace 'KA01AB1234' with the plate you intend to scan
    await db.collection("users").doc("KA01AB1234").set(testUser);
    console.log("✅ Test user created.");

    // 2. Add an Initial Toll Zone
    const testZone = {
      name: "City Gateway",
      center: { lat: 12.9716, lng: 77.5946 },
      coordinates: [
        { lat: 12.98, lng: 77.59 },
        { lat: 12.98, lng: 77.60 },
        { lat: 12.97, lng: 77.60 },
        { lat: 12.97, lng: 77.59 }
      ],
      max_distance: 5000,
      flat_rate: 150,
      operators: {
        "CAM-01": {
          cameraType: "EDGE",
          location: { lat: 12.975, lng: 77.595 },
          password: "password123",
          tollZoneName: "City Gateway"
        }
      }
    };

    await db.collection("tollZones").add(testZone);
    console.log("✅ Test zone and camera created.");

    console.log("Data initialization complete! You can now log in with CAM-01.");
    process.exit();
  } catch (error) {
    console.error("Error seeding data:", error);
    process.exit(1);
  }
};

seedData();
