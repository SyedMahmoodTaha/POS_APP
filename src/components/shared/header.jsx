import React from "react";
import { FaSearch } from "react-icons/fa";
import { FaUserCircle } from "react-icons/fa";
import { FaSignOutAlt } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { getCurrentUser, signOut } from "../../utils/auth";
const logo = `${import.meta.env.BASE_URL}Logo.png`;
const Header = () => {
    const navigate = useNavigate();
    const user = getCurrentUser();

    const handleSignOut = () => {
        signOut();
        navigate("/Auth", { replace: true });
    };

    return(
       <header className="flex justify-between items-center py-4 px-8 bg-[#1a1a1a]">
        {/* Logo */}
        <div className="flex items-center gap-2">
            <img src={logo} className="h-8 w-8" alt="Logo" />
            <h1 className="text-lg font-semibold text-[#f5f5f5]">Lassi Shop</h1>
        </div>
        {/* Search */}
        <div className="flex items-center gap-4 bg-[#1f1f1f] rounded-[15px] px-5 py-2 w-[500px]">
            <FaSearch className="text-[#f5f5f5]" />
            <input 
            type="text"
            placeholder="Search" 
            className="bg-[#1f1f1f] outline-none text-[#f5f5f5]"
            />
        </div>
        {/* Logged users Details */}
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 cursor-pointer">
                <FaUserCircle className="text-[#f5f5f5] text-4xl" />
                <div className="flex flex-col items-start">
                    <h1 className="text-md text-[#f5f5f5] font-semibold">{user?.name}</h1>
                    <p className="text-xs text-[#ababab] font-medium">{user?.role}</p>
                </div>
            </div>
            <button type="button" onClick={handleSignOut} className="flex size-10 items-center justify-center rounded-full text-[#ababab] transition-colors hover:bg-[#d3d3d3] hover:text-[#1a1a1a]" aria-label="Sign out" title="Sign out">
                <FaSignOutAlt />
            </button>
        </div>
       </header>
    )
}

export default Header