import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";

export const Hero = () => {
  return (
    <section
      aria-label="RetinaCare AI hero"
      className="relative overflow-hidden"
    >
      <div
        className="absolute inset-0 -z-10 animate-spotlight"
        style={{ background: 'var(--gradient-hero)' }}
      />
      <div className="container py-16 md:py-28 text-center">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            Early eye care with AI-backed diabetic retinopathy insights
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Upload fundus images, get stage suggestions, track progress, and book top-rated ophthalmologists nearby.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Button size="lg" asChild>
              <Link to="/auth">Get started</Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link to="/dashboard">View dashboard</Link>
            </Button>
          </div>
        </div>

        <Card className="mt-12 md:mt-16 p-4 md:p-6 shadow-[var(--shadow-elevated)]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Feature title="DR Screening" desc="5-stage assessment with templated reports." />
            <Feature title="Doctor Finder" desc="Experience, degree and rating filters." />
            <Feature title="Care Reminders" desc="Medicine, checkups and follow-ups." />
          </div>
        </Card>
      </div>
    </section>
  );
};

const Feature = ({ title, desc }: { title: string; desc: string }) => (
  <div className="text-left">
    <h3 className="font-semibold text-lg">{title}</h3>
    <p className="text-sm text-muted-foreground mt-1">{desc}</p>
  </div>
);
