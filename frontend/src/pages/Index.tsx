import { useEffect } from "react";
import { Hero } from "@/components/marketing/Hero";
import { Card } from "@/components/ui/card";

const Index = () => {
  useEffect(() => {
    document.title = "RetinaCare AI — Diabetic Retinopathy Assistant";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <section className="container py-16">
        <Card className="p-6">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <ol className="mt-4 grid gap-4 md:grid-cols-3 text-sm text-muted-foreground">
            <li>1. Sign up and upload a retinal image.</li>
            <li>2. Get a stage-based DR summary and PDF report.</li>
            <li>3. Track progress, set reminders, and consult nearby doctors.</li>
          </ol>
        </Card>
      </section>
    </div>
  );
};

export default Index;
