import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import React from "react";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "subtle" | "strong";
  glow?: "primary" | "accent" | "success" | "none";
  animated?: boolean;
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = "default", glow = "none", animated = true, children, ...props }, ref) => {
    const glassClass = {
      default: "glass",
      subtle: "glass-subtle",
      strong: "glass-strong",
    }[variant];

    const glowClass = {
      primary: "glow-primary",
      accent: "glow-accent",
      success: "glow-success",
      none: "",
    }[glow];

    const Wrapper = animated ? motion.div : "div";
    const animProps = animated
      ? {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: "easeOut" },
        }
      : {};

    return (
      <Wrapper
        ref={ref}
        className={cn("rounded-xl p-5", glassClass, glowClass, className)}
        {...animProps}
        {...(props as any)}
      >
        {children}
      </Wrapper>
    );
  }
);

GlassCard.displayName = "GlassCard";
export default GlassCard;
