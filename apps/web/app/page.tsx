import { AnnouncementBar } from "@/components/announcement-bar";
import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { TrustBar } from "@/components/trust-bar";
import { ProblemSolution } from "@/components/problem-solution";
import { Features } from "@/components/features";
import { HowItWorks } from "@/components/how-it-works";
import { Migration } from "@/components/migration";
import { Pricing } from "@/components/pricing";
import { Industries } from "@/components/industries";
import { TrustSecurity } from "@/components/trust-security";
import { Faq } from "@/components/faq";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";

export default function HomePage() {
  return (
    <>
      <AnnouncementBar />
      <Header />
      <main id="main">
        <Hero />
        <TrustBar />
        <ProblemSolution />
        <Features />
        <HowItWorks />
        <Migration />
        <Pricing />
        <Industries />
        <TrustSecurity />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
