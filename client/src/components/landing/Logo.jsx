import React from 'react';
import logoSvg from '../../assets/logo.svg';

const Logo = ({ className = '', collapsed = false }) => {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="relative flex-shrink-0">
        <img src={logoSvg} alt="Polyglot Logo" className="w-7 h-7" />
      </div>
      {!collapsed && (
        <div className="flex flex-col leading-none">
          <span className="font-display font-black text-lg tracking-tight text-white">
            Polyglot
          </span>
        </div>
      )}
    </div>
  );
};

export default Logo;