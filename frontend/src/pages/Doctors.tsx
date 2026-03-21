import { lazy, Suspense, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Star, MapPin, Phone, Mail, Globe, Loader2, Navigation, Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import apiService from "@/lib/api";
import type { ClinicPin } from "@/components/DoctorMap";

const DoctorMap = lazy(() => import("@/components/DoctorMap"));

interface Doctor {
  _id: string;
  user: { firstName: string; lastName: string; email: string; profileImage?: string | null };
  specialization: string;
  experience: number;
  location?: { coordinates?: [number, number]; address?: { formatted?: string } };
  rating?: { average: number; count: number };
  distance?: number | null;
  contact?: { phone?: string | null; email?: string | null; website?: string | null };
}

const SPECIALIZATIONS = [
  "All",
  "Retina Specialist",
  "Ophthalmologist",
  "Optometrist",
  "General Eye Care",
];

const doctorLatLng = (d: Doctor): [number, number] | null => {
  try {
    const c = d.location?.coordinates;
    if (c && c.length === 2 && (c[0] !== 0 || c[1] !== 0))
      return [c[1], c[0]]; // MongoDB stores [lng, lat]
  } catch { /* ignore */ }
  return null;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Fetch real nearby clinics/hospitals from OpenStreetMap Overpass API (free, no key)
async function fetchNearbyClinics(lat: number, lng: number, radiusKm: number): Promise<ClinicPin[]> {
  const radius = radiusKm * 1000;
  const query = `
    [out:json][timeout:15];
    (
      node["healthcare"="doctor"](around:${radius},${lat},${lng});
      node["healthcare"="clinic"](around:${radius},${lat},${lng});
      node["amenity"="clinic"](around:${radius},${lat},${lng});
      node["amenity"="hospital"](around:${radius},${lat},${lng});
    );
    out body;
  `.trim();

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
  });
  if (!res.ok) throw new Error("Overpass API error");
  const data = await res.json();

  return (data.elements || [])
    .filter((el: any) => el.tags?.name)
    .map((el: any) => {
      const tags = el.tags || {};
      const parts = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:city"],
      ].filter(Boolean);
      return {
        id: el.id,
        position: [el.lat, el.lon] as [number, number],
        name: tags.name,
        phone: tags.phone || tags["contact:phone"] || undefined,
        address: parts.length > 0 ? parts.join(", ") : undefined,
        website: tags.website || tags["contact:website"] || undefined,
        distanceKm: haversineKm(lat, lng, el.lat, el.lon),
      };
    })
    .sort((a: ClinicPin, b: ClinicPin) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
}

export default function Doctors() {
  const { toast } = useToast();
  const { user } = useAuth();

  // Current user id — used to detect already-reviewed doctors
  const currentUserId = user?._id ?? "";

  // App doctors
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [specFilter, setSpecFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const DOCTORS_PER_PAGE = 12;
  // Track doctorIds the current user has already reviewed (optimistic + from data)
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

  // Nearby clinics (Overpass)
  const [clinics, setClinics] = useState<ClinicPin[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [clinicRadius, setClinicRadius] = useState(5);
  const [manualCoords, setManualCoords] = useState({ lat: "", lng: "" });

  // Booking modal
  const [bookingDoctor, setBookingDoctor] = useState<Doctor | null>(null);
  const [bookingForm, setBookingForm] = useState({ reason: "", notes: "" });
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingDate, setBookingDate] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState("");

  // Rating modal
  const [ratingDoctor, setRatingDoctor] = useState<Doctor | null>(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingLoading, setRatingLoading] = useState(false);

  // Reset slot state when opening a new booking modal
  useEffect(() => {
    if (bookingDoctor) {
      setBookingDate("");
      setSlots([]);
      setSelectedSlot("");
    }
  }, [bookingDoctor]);

  // Fetch available slots when date changes
  useEffect(() => {
    if (!bookingDate || !bookingDoctor) return;
    setSlotsLoading(true);
    apiService.getDoctorSlots(bookingDoctor._id, bookingDate)
      .then(({ slots: s }) => setSlots(s))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [bookingDate, bookingDoctor]);

  // Load app doctors on mount and when page/filter changes
  useEffect(() => {
    loadAppDoctors(page);
  }, [page, specFilter]);

  useEffect(() => {
    tryGeolocation();
  }, []);

  const loadAppDoctors = async (p = page) => {
    setLoadingDoctors(true);
    try {
      const filters: Record<string, any> = { limit: DOCTORS_PER_PAGE, page: p };
      if (specFilter !== "All") filters.specialization = specFilter;
      const res = await apiService.getAllDoctors(filters);
      const list: Doctor[] = res?.doctors ?? [];
      setDoctors(list);
      setTotalPages(res?.pagination?.total ?? 1);
      // Seed reviewedIds from server data — any doctor whose reviews[] contains currentUserId
      if (currentUserId) {
        const alreadyReviewed = new Set<string>(
          list
            .filter((d: any) =>
              Array.isArray(d.reviews) &&
              d.reviews.some((r: any) => {
                const uid = r.user?._id ?? r.user;
                return uid?.toString() === currentUserId;
              })
            )
            .map((d) => d._id)
        );
        setReviewedIds((prev) => {
          const merged = new Set(prev);
          alreadyReviewed.forEach((id) => merged.add(id));
          return merged;
        });
      }
    } catch {
      toast({ title: "Could not load doctors", variant: "destructive" });
    } finally {
      setLoadingDoctors(false);
    }
  };

  const tryGeolocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (pos.coords.latitude === 0 && pos.coords.longitude === 0) return;
        const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation(loc);
        // Auto-fetch nearby clinics once we have location
        handleFetchClinics(loc);
      },
      () => { /* silent — user can enter manually */ },
      { timeout: 10000, maximumAge: 60_000 }
    );
  };

  const handleFetchClinics = async (loc?: [number, number]) => {
    const location = loc ?? userLocation;
    if (!location) {
      toast({ title: "Location required", description: "Allow location or enter coordinates below.", variant: "destructive" });
      return;
    }
    setLoadingClinics(true);
    try {
      const results = await fetchNearbyClinics(location[0], location[1], clinicRadius);
      setClinics(results);
      if (results.length === 0) {
        toast({ title: "No clinics found nearby", description: "Try increasing the radius." });
      } else {
        toast({ title: `Found ${results.length} nearby clinics`, description: "Shown as red pins on the map." });
      }
    } catch {
      toast({ title: "Could not fetch nearby clinics", description: "OpenStreetMap Overpass API unavailable.", variant: "destructive" });
    } finally {
      setLoadingClinics(false);
    }
  };

  const useManualCoords = () => {
    const lat = parseFloat(manualCoords.lat);
    const lng = parseFloat(manualCoords.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const loc: [number, number] = [lat, lng];
      setUserLocation(loc);
      toast({ title: "Location set" });
      handleFetchClinics(loc);
    } else {
      toast({ title: "Invalid coordinates", variant: "destructive" });
    }
  };

  const handleBookAppointment = async () => {
    if (!bookingDoctor || !bookingDate || !selectedSlot || !bookingForm.reason) {
      toast({ title: "Fill all required fields", variant: "destructive" });
      return;
    }
    if (bookingLoading) return; // sync guard against double-click
    setBookingLoading(true);
    try {
      // Combine date + selected slot time into a full ISO datetime
      const dateTime = `${bookingDate}T${selectedSlot}`;
      await apiService.bookAppointment({
        doctorId: bookingDoctor._id,
        date: dateTime,
        reason: bookingForm.reason,
        notes: bookingForm.notes || undefined,
      });
      toast({ title: "Appointment booked!", description: `With Dr. ${bookingDoctor.user.firstName} ${bookingDoctor.user.lastName}` });
      setBookingDoctor(null);
      setBookingForm({ reason: "", notes: "" });
    } catch (err: unknown) {
      toast({ title: "Booking failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setBookingLoading(false);
    }
  };

  const handleSubmitRating = async () => {
    if (!ratingDoctor || ratingValue === 0) {
      toast({ title: "Select a star rating", variant: "destructive" });
      return;
    }
    setRatingLoading(true);
    try {
      await apiService.addDoctorReview(ratingDoctor._id, { rating: ratingValue, comment: ratingComment || undefined });
      toast({ title: "Review submitted!", description: `You rated Dr. ${ratingDoctor.user.firstName} ${ratingValue} star${ratingValue > 1 ? "s" : ""}.` });
      setReviewedIds((prev) => new Set(prev).add(ratingDoctor._id));
      setRatingDoctor(null);
      setRatingValue(0);
      setRatingComment("");
      loadAppDoctors();
    } catch (err: unknown) {
      toast({ title: "Rating failed", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setRatingLoading(false);
    }
  };

  const mapCenter: [number, number] = userLocation ?? [20.5937, 78.9629];

  // Enrich each doctor with a computed distance (client-side haversine) when we have user location
  const enrichedDoctors = doctors.map((d) => {
    const pos = doctorLatLng(d);
    const distance = (pos && userLocation)
      ? haversineKm(userLocation[0], userLocation[1], pos[0], pos[1])
      : null;
    return { ...d, _position: pos, _distance: distance };
  });

  const mapDoctors = enrichedDoctors.map((d) => ({
    _id: d._id,
    position: d._position,
    name: `Dr. ${d.user.firstName} ${d.user.lastName}`,
    specialization: d.specialization,
    address: d.location?.address?.formatted,
    rating: d.rating,
    distance: d._distance,
  }));

  return (
    <div className="container py-10 space-y-10">

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold">Find Doctors</h1>
        <p className="text-muted-foreground">Specialists registered on MeddyCare + real nearby clinics</p>
      </div>

      {/* ══════════════════════════════════════════
          SECTION 1 — App-registered doctor cards
      ══════════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
            MeddyCare Doctors
            {!loadingDoctors && (
              <Badge variant="secondary">{doctors.length}</Badge>
            )}
          </h2>

          {/* Specialization filter */}
          <div className="w-52">
            <Select value={specFilter} onValueChange={(v) => { setPage(1); setSpecFilter(v); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPECIALIZATIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loadingDoctors ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : doctors.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <p className="text-muted-foreground">No doctors found for this specialization.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {enrichedDoctors.map((doctor) => (
              <Card key={doctor._id} className="hover:shadow-lg transition-shadow flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">
                        Dr. {doctor.user.firstName} {doctor.user.lastName}
                      </CardTitle>
                      <CardDescription className="mt-0.5">{doctor.specialization}</CardDescription>
                    </div>
                    {doctor.user.profileImage ? (
                      <img
                        src={doctor.user.profileImage}
                        alt={doctor.user.firstName}
                        className="w-11 h-11 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-primary font-semibold text-sm">
                          {doctor.user.firstName[0]}{doctor.user.lastName[0]}
                        </span>
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="flex-1 flex flex-col justify-between gap-4">
                  <div className="space-y-2 text-sm">
                    {/* Rating */}
                    <div className="flex items-center gap-1.5">
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 shrink-0" />
                      <span>{doctor.rating?.average?.toFixed(1) ?? "New"}</span>
                      <span className="text-muted-foreground">({doctor.rating?.count ?? 0} reviews)</span>
                    </div>

                    {/* Experience */}
                    <p className="text-muted-foreground">
                      {doctor.experience} yr{doctor.experience !== 1 ? "s" : ""} experience
                    </p>

                    {/* Distance */}
                    {doctor._distance != null && (
                      <div className="flex items-center gap-1.5 text-primary font-medium">
                        <MapPin className="w-4 h-4 shrink-0" />
                        <span>{doctor._distance.toFixed(1)} km away</span>
                      </div>
                    )}

                    {/* Location */}
                    {doctor.location?.address?.formatted && (
                      <div className="flex items-start gap-1.5 text-muted-foreground">
                        <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{doctor.location.address.formatted}</span>
                      </div>
                    )}

                    {/* Contact buttons */}
                    {(doctor.contact?.phone || doctor.contact?.email || doctor.contact?.website) && (
                      <div className="flex gap-2 flex-wrap pt-1">
                        {doctor.contact.phone && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" asChild>
                            <a href={`tel:${doctor.contact.phone}`}>
                              <Phone className="w-3 h-3" /> Call
                            </a>
                          </Button>
                        )}
                        {doctor.contact.email && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" asChild>
                            <a href={`mailto:${doctor.contact.email}`}>
                              <Mail className="w-3 h-3" /> Email
                            </a>
                          </Button>
                        )}
                        {doctor.contact.website && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" asChild>
                            <a href={doctor.contact.website} target="_blank" rel="noreferrer">
                              <Globe className="w-3 h-3" /> Web
                            </a>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-2">
                    <Button className="flex-1" onClick={() => setBookingDoctor(doctor)}>
                      Book Appointment
                    </Button>
                    {reviewedIds.has(doctor._id) ? (
                      <div className="flex items-center gap-1.5 px-3 text-sm text-yellow-500 font-medium">
                        <Star className="w-3.5 h-3.5 fill-yellow-500" /> Rated
                      </div>
                    ) : (
                      <Button variant="outline" className="gap-1.5 px-3" onClick={() => { setRatingDoctor(doctor); setRatingValue(0); setRatingComment(""); }}>
                        <Star className="w-3.5 h-3.5" /> Rate
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button
              size="icon"
              variant="outline"
              disabled={page <= 1 || loadingDoctors}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              size="icon"
              variant="outline"
              disabled={page >= totalPages || loadingDoctors}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════
          SECTION 2 — Nearby Clinics Map (Overpass)
      ══════════════════════════════════════════ */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Nearby Clinics &amp; Hospitals
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — powered by OpenStreetMap (free)
          </span>
        </h2>

        {/* Location permission prompt — shown when no location yet */}
        {!userLocation && (
          <Card className="p-5 border-primary/30 bg-primary/5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1 space-y-1">
                <p className="font-semibold flex items-center gap-2">
                  <Navigation className="h-4 w-4 text-primary" />
                  Allow location to find nearby clinics
                </p>
                <p className="text-sm text-muted-foreground">
                  Your browser will ask for permission — click <strong>Allow</strong> in the popup.
                </p>
                <p className="text-xs text-muted-foreground">
                  If blocked: click the 🔒 icon in your address bar → Location → Allow → refresh.
                </p>
              </div>
              <Button onClick={tryGeolocation} className="gap-2 shrink-0">
                <MapPin className="h-4 w-4" /> Allow My Location
              </Button>
            </div>

            {/* Manual coords fallback */}
            <div className="mt-4 pt-4 border-t border-primary/20">
              <p className="text-xs text-muted-foreground mb-2">Or enter coordinates manually (right-click on Google Maps to get them):</p>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="Latitude (28.6139)"
                  value={manualCoords.lat}
                  onChange={(e) => setManualCoords({ ...manualCoords, lat: e.target.value })}
                  className="text-sm"
                />
                <Input
                  placeholder="Longitude (77.2090)"
                  value={manualCoords.lng}
                  onChange={(e) => setManualCoords({ ...manualCoords, lng: e.target.value })}
                  className="text-sm"
                />
                <Button variant="outline" onClick={useManualCoords}>Use These</Button>
              </div>
            </div>
          </Card>
        )}

        {/* Controls (shown only when location is available) */}
        {userLocation && (
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Location status */}
              <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5 font-medium">
                <Navigation className="h-3.5 w-3.5" />
                {userLocation[0].toFixed(4)}, {userLocation[1].toFixed(4)}
              </span>

              <div className="flex items-center gap-2 ml-auto">
                <Select value={String(clinicRadius)} onValueChange={(v) => setClinicRadius(Number(v))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent side="top">
                    {[1, 2, 5, 10, 20].map((r) => (
                      <SelectItem key={r} value={String(r)}>{r} km</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => handleFetchClinics()} disabled={loadingClinics} className="gap-2">
                  {loadingClinics
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching...</>
                    : <><Navigation className="h-4 w-4" /> Search</>
                  }
                </Button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex gap-5 text-xs text-muted-foreground mt-3 pt-3 border-t">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> You
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> MeddyCare Doctors
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Nearby Clinics
              </span>
            </div>
          </Card>
        )}

        {/* Map — smaller height */}
        <Card className="overflow-hidden">
          <div style={{ height: 320 }}>
            <Suspense fallback={
              <div className="h-full flex items-center justify-center bg-muted/30">
                <div className="text-center text-muted-foreground">
                  <MapPin className="w-8 h-8 mx-auto mb-2 animate-pulse" />
                  <p className="text-sm">Loading map...</p>
                </div>
              </div>
            }>
              <DoctorMap
                center={mapCenter}
                zoom={userLocation ? 14 : 5}
                userLocation={userLocation}
                doctors={mapDoctors}
                clinics={clinics}
              />
            </Suspense>
          </div>
        </Card>

        {/* Clinic cards */}
        {clinics.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">{clinics.length} places found within {clinicRadius} km</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {clinics.slice(0, 12).map((clinic) => (
                <Card key={clinic.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0 mt-0.5">
                        <Building2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm line-clamp-1">{clinic.name}</p>
                        {clinic.address && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{clinic.address}</p>
                        )}
                      </div>
                    </div>
                    {clinic.distanceKm != null && (
                      <Badge variant="secondary" className="text-xs w-fit">
                        📍 {clinic.distanceKm.toFixed(1)} km away
                      </Badge>
                    )}
                    <div className="flex gap-2 pt-1 flex-wrap">
                      {clinic.phone && (
                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" asChild>
                          <a href={`tel:${clinic.phone}`}><Phone className="w-3 h-3" /> {clinic.phone}</a>
                        </Button>
                      )}
                      {clinic.website ? (
                        <Button size="sm" variant="outline" className="h-8 px-3 text-xs gap-1" asChild>
                          <a href={clinic.website} target="_blank" rel="noreferrer">
                            <Globe className="w-3 h-3" /> Website
                          </a>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-8 px-3 text-xs gap-1 text-muted-foreground" asChild>
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(clinic.name + (clinic.address ? " " + clinic.address : ""))}`}
                            target="_blank" rel="noreferrer"
                          >
                            🔍 Search
                          </a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Booking Modal ── */}
      <Dialog open={!!bookingDoctor} onOpenChange={(open) => !open && setBookingDoctor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Book Appointment
              {bookingDoctor && ` — Dr. ${bookingDoctor.user.firstName} ${bookingDoctor.user.lastName}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="appt-date">Date <span className="text-destructive">*</span></Label>
              <Input
                id="appt-date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={bookingDate}
                onChange={(e) => { setBookingDate(e.target.value); setSelectedSlot(""); }}
                disabled={bookingLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Time Slot <span className="text-destructive">*</span></Label>
              {!bookingDate ? (
                <p className="text-sm text-muted-foreground">Select a date first to see available slots.</p>
              ) : slotsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading slots...
                </div>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No available slots on this date. Try another day.</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      disabled={bookingLoading}
                      className={`px-2 py-2 rounded-lg text-sm font-medium border transition-all ${
                        selectedSlot === slot
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-background border-border hover:border-primary/50 hover:bg-primary/5"
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appt-reason">Reason <span className="text-destructive">*</span></Label>
              <Input
                id="appt-reason"
                placeholder="e.g. Annual eye checkup"
                value={bookingForm.reason}
                onChange={(e) => setBookingForm({ ...bookingForm, reason: e.target.value })}
                disabled={bookingLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appt-notes">Notes (optional)</Label>
              <Input
                id="appt-notes"
                placeholder="Any additional info for the doctor"
                value={bookingForm.notes}
                onChange={(e) => setBookingForm({ ...bookingForm, notes: e.target.value })}
                disabled={bookingLoading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingDoctor(null)} disabled={bookingLoading}>
              Cancel
            </Button>
            <Button onClick={handleBookAppointment} disabled={bookingLoading || !selectedSlot || !bookingDate}>
              {bookingLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Booking...</> : "Confirm Booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rate Doctor Dialog ── */}
      <Dialog open={!!ratingDoctor} onOpenChange={(open) => !open && setRatingDoctor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rate Dr. {ratingDoctor?.user.firstName} {ratingDoctor?.user.lastName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Your Rating</Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} type="button" onClick={() => setRatingValue(star)} className="focus:outline-none">
                    <Star className={`w-8 h-8 transition-colors ${star <= ratingValue ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rating-comment">Comment (optional)</Label>
              <Input
                id="rating-comment"
                placeholder="Share your experience..."
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRatingDoctor(null)} disabled={ratingLoading}>Cancel</Button>
            <Button onClick={handleSubmitRating} disabled={ratingLoading || ratingValue === 0}>
              {ratingLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Submitting...</> : "Submit Rating"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
