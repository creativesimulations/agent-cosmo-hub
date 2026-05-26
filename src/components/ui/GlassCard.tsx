import { cn } from "@/lib/utils";
import { motion, type HTMLMotionProps } from "framer-motion";
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

    const finalClass = cn("rounded-xl p-5", glassClass, glowClass, className);

    if (animated) {
      // Strip native DOM animation handlers that conflict with framer-motion's signatures.
      const { onAnimationStart, onAnimationEnd, onAnimationIteration, onDrag, onDragStart, onDragEnd, ...rest } = props;
      void onAnimationStart; void onAnimationEnd; void onAnimationIteration;
      void onDrag; void onDragStart; void onDragEnd;
      return (
        <motion.div
          ref={ref}
          className={finalClass}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          {...(rest as HTMLMotionProps<"div">)}
        >
          {children}
        </motion.div>
      );
    }
    return (
      <div ref={ref} className={finalClass} {...props}>
        {children}
      </div>
    );
  }
);

GlassCard.displayName = "GlassCard";
export default GlassCard;
