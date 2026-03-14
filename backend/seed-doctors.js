import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Doctor from './models/Doctor.js';

dotenv.config();

const sampleDoctors = [
  {
    user: {
      firstName: "Dr. John",
      lastName: "Smith",
      email: "john.smith@retina.com",
      profileImage: null,
    },
    specialization: "Retina Specialist",
    experience: 15,
    location: {
      type: "Point",
      coordinates: [-74.006, 40.7128], // New York coordinates
      address: {
        street: "123 Medical Center Dr",
        city: "New York",
        state: "NY",
        zipCode: "10001",
        country: "USA",
        formatted: "123 Medical Center Dr, New York, NY 10001"
      }
    },
    rating: {
      average: 4.8,
      count: 127
    },
    contact: {
      phone: "+1-555-0123",
      email: "john.smith@retina.com",
      website: "https://drjohnsmith.com"
    },
    licenseNumber: "MD123456",
    isVerified: true,
    isActive: true
  },
  {
    user: {
      firstName: "Dr. Sarah",
      lastName: "Johnson",
      email: "sarah.johnson@eye.com",
      profileImage: null,
    },
    specialization: "Ophthalmologist",
    experience: 12,
    location: {
      type: "Point",
      coordinates: [-74.006, 40.7128], // New York coordinates
      address: {
        street: "456 Eye Care Ave",
        city: "New York",
        state: "NY",
        zipCode: "10002",
        country: "USA",
        formatted: "456 Eye Care Ave, New York, NY 10002"
      }
    },
    rating: {
      average: 4.6,
      count: 89
    },
    contact: {
      phone: "+1-555-0456",
      email: "sarah.johnson@eye.com",
      website: null
    },
    licenseNumber: "MD789012",
    isVerified: true,
    isActive: true
  },
  {
    user: {
      firstName: "Dr. Michael",
      lastName: "Chen",
      email: "michael.chen@retina.com",
      profileImage: null,
    },
    specialization: "Retina Specialist",
    experience: 18,
    location: {
      type: "Point",
      coordinates: [-74.006, 40.7128], // New York coordinates
      address: {
        street: "789 Vision Blvd",
        city: "New York",
        state: "NY",
        zipCode: "10003",
        country: "USA",
        formatted: "789 Vision Blvd, New York, NY 10003"
      }
    },
    rating: {
      average: 4.9,
      count: 203
    },
    contact: {
      phone: "+1-555-0789",
      email: "michael.chen@retina.com",
      website: "https://drchen.com"
    },
    licenseNumber: "MD345678",
    isVerified: true,
    isActive: true
  }
];

async function seedDoctors() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing doctors
    await Doctor.deleteMany({});
    console.log('🗑️ Cleared existing doctors');

    // Create users first
    const createdUsers = [];
    for (const doctorData of sampleDoctors) {
      const user = new User({
        email: doctorData.user.email,
        password: 'password123', // This will be hashed automatically
        firstName: doctorData.user.firstName,
        lastName: doctorData.user.lastName,
        role: 'doctor'
      });
      const savedUser = await user.save();
      createdUsers.push(savedUser);
    }
    console.log('👥 Created users for doctors');

    // Create doctors
    const doctors = [];
    for (let i = 0; i < sampleDoctors.length; i++) {
      const doctorData = sampleDoctors[i];
      const user = createdUsers[i];
      
      const doctor = new Doctor({
        user: user._id,
        specialization: doctorData.specialization,
        experience: doctorData.experience,
        location: doctorData.location,
        rating: doctorData.rating,
        contact: doctorData.contact,
        licenseNumber: doctorData.licenseNumber,
        isVerified: doctorData.isVerified,
        isActive: doctorData.isActive
      });
      
      const savedDoctor = await doctor.save();
      doctors.push(savedDoctor);
    }
    console.log('👨‍⚕️ Created doctors');

    console.log('✅ Database seeded successfully!');
    console.log(`📊 Created ${doctors.length} doctors`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seedDoctors();
