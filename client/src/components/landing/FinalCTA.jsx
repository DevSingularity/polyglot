import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';

export default function FinalCTA() {
  return (
    <section className="relative py-24 sm:py-32 bg-card overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(212,175,55,0.15),transparent_70%)] pointer-events-none" />
      
      <div className="max-w-5xl mx-auto px-4 sm:px-8 relative z-10">
        <div className="bg-card rounded-[3rem] p-12 sm:p-20 text-center relative overflow-hidden shadow-neu-inset border border-border/20">
          
          {/* Decorative bits */}
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute -top-20 -right-20 w-80 h-80 bg-gold/5 rounded-full blur-3xl pointer-events-none"
          />
          <motion.div 
            animate={{ rotate: -360 }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="absolute -bottom-20 -left-20 w-80 h-80 bg-gold/10 rounded-full blur-3xl pointer-events-none"
          />

          <div className="relative z-10 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/5 border border-gold/20 text-gold text-xs font-bold uppercase tracking-widest mb-8">
              <Sparkles size={14} className="text-gold" />
              <span>Ready to Level Up?</span>
            </div>

            <h2 className="text-4xl sm:text-6xl font-display font-extrabold text-white leading-tight mb-8">
              Master the Complexity of Your Codebase.
            </h2>

            <p className="text-slate-400 text-lg sm:text-xl font-light mb-12 leading-relaxed">
              Stop guessing. Start knowing. Join 500+ developers mapping 
              cross-language dependencies with Antigravity.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link 
                to="/signup"
                className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-gold text-white font-bold text-lg hover:bg-gold/90 shadow-lg shadow-gold/20 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                Get Started for Free <ArrowRight size={20} />
              </Link>
              <Link 
                to="/demo"
                className="w-full sm:w-auto px-10 py-5 rounded-2xl shadow-neu-inset bg-muted/40 text-gold border border-transparent font-bold text-lg hover:bg-muted/60 transition-all duration-500 flex items-center justify-center gap-2"
              >
                Schedule a Demo
              </Link>
            </div>
            
            <p className="mt-10 text-gold/50 text-[10px] font-mono tracking-[0.2em] uppercase">
              Free forever for open source · Enterprise plans available
            </p>
          </div>

        </div>
      </div>
    </section>
  );
}
