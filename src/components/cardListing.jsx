import React from 'react';
import './css/cardListing.css';

function cardListing() {
  return (
    <div className="ad-container">
      <img 
        src='../assets/react.svg'
        alt="Kitchen Aid Mixer"
        className="ad-image"
      />
      <div className="ad-overlay">
        <h2>Kitchen Aid Mixer</h2>
        <p className="ad-price">$25</p>
      </div>
    </div>
  );
};

export default cardListing;
