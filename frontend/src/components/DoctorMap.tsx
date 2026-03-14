import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl; // eslint-disable-line
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const SHADOW = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";
const MARKER_BASE = "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img";

const userIcon = new L.Icon({
  iconUrl: `${MARKER_BASE}/marker-icon-blue.png`,
  shadowUrl: SHADOW,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

// Green = app-registered doctors (can book)
const appDoctorIcon = new L.Icon({
  iconUrl: `${MARKER_BASE}/marker-icon-green.png`,
  shadowUrl: SHADOW,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

// Red = real-world clinics from OpenStreetMap (contact info only)
const clinicIcon = new L.Icon({
  iconUrl: `${MARKER_BASE}/marker-icon-red.png`,
  shadowUrl: SHADOW,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

export interface ClinicPin {
  id: number;
  position: [number, number];
  name: string;
  phone?: string;
  address?: string;
  website?: string;
  distanceKm?: number;
}

interface DoctorMapProps {
  center: [number, number];
  zoom: number;
  userLocation: [number, number] | null;
  doctors: Array<{
    _id: string;
    position: [number, number] | null;
    name: string;
    specialization: string;
    address?: string;
    rating?: { average: number; count: number };
    distance?: number | null;
  }>;
  clinics?: ClinicPin[];
}

export default function DoctorMap({ center, zoom, userLocation, doctors, clinics = [] }: DoctorMapProps) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController center={center} zoom={zoom} />

      {/* Blue pin — user's location */}
      {userLocation && (
        <Marker position={userLocation} icon={userIcon}>
          <Popup><strong>Your Location</strong></Popup>
        </Marker>
      )}

      {/* Green pins — app-registered doctors */}
      {doctors.map((doc) => {
        if (!doc.position) return null;
        return (
          <Marker key={doc._id} position={doc.position} icon={appDoctorIcon}>
            <Popup>
              <div style={{ minWidth: 200 }}>
                <p style={{ fontWeight: 700, marginBottom: 2 }}>{doc.name}</p>
                <p style={{ fontSize: 13, color: "#555" }}>{doc.specialization}</p>
                {doc.address && <p style={{ fontSize: 12, marginTop: 4 }}>{doc.address}</p>}
                {doc.rating && (
                  <p style={{ fontSize: 12, marginTop: 4 }}>
                    ⭐ {doc.rating.average.toFixed(1)} ({doc.rating.count} reviews)
                  </p>
                )}
                {doc.distance != null && (
                  <p style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                    📍 {Number(doc.distance).toFixed(1)} km away
                  </p>
                )}
                <p style={{ fontSize: 11, color: "#22c55e", marginTop: 6, fontWeight: 600 }}>
                  ✅ Available on MeddyCare
                </p>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Red pins — real-world clinics from OpenStreetMap */}
      {clinics.map((clinic) => (
        <Marker key={clinic.id} position={clinic.position} icon={clinicIcon}>
          <Popup>
            <div style={{ minWidth: 200 }}>
              <p style={{ fontWeight: 700, marginBottom: 2 }}>{clinic.name}</p>
              {clinic.address && <p style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{clinic.address}</p>}
              {clinic.phone && (
                <p style={{ fontSize: 12, marginTop: 4 }}>
                  📞 <a href={`tel:${clinic.phone}`} style={{ color: "#2563eb" }}>{clinic.phone}</a>
                </p>
              )}
              {clinic.distanceKm != null && (
                <p style={{ fontSize: 12, marginTop: 4 }}>📍 {clinic.distanceKm.toFixed(1)} km away</p>
              )}
              {clinic.website && (
                <p style={{ fontSize: 12, marginTop: 2 }}>
                  🌐 <a href={clinic.website} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>Website</a>
                </p>
              )}
              {!clinic.website && (
                <p style={{ fontSize: 12, marginTop: 2 }}>
                  🔍 <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(clinic.name + (clinic.address ? " " + clinic.address : ""))}`}
                    target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>Search on Google</a>
                </p>
              )}
              <p style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                📌 From OpenStreetMap — contact directly
              </p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
