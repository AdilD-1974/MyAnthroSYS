import React from "react";
import logoIcon from "@/assets/logo-icon.png";
import logoFull from "@/assets/logo-full.png";

interface LogoProps {
  collapsed?: boolean;
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ collapsed = false, className = "" }) => {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {collapsed ? (
        <img src={logoIcon} alt="ANTHRO-SYS" className="w-12 h-12 object-contain" />
      ) : (
        <img src={logoFull} alt="ANTHRO-SYS" className="h-14 object-contain max-w-full" />
      )}
    </div>
  );
};

export default Logo;
