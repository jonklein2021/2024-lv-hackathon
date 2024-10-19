import React, { useEffect, useState } from 'react'
import { auth, db } from '../../firebase/config';
import { onValue, ref } from 'firebase/database';
import NavBar from '../../components/navbar.jsx';
import { onAuthStateChanged } from 'firebase/auth';

function Listings() {
  const [products, setProducts] = useState([]);

  useEffect(() => {// ensure user is logged in
    onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserID(user.uid);
        fetchProducts();
      } else {
        navigate('/login');
      }
    });
  }, []);

  // fetch products from firebase
  const fetchProducts = () => {
    ;
    const productsRef = ref(db, 'products');

    onValue(productsRef, (snapshot) => {
      const data = snapshot.val();
      const products = [];
      for (let id in data) {
        products.push({ id, ...data[id] });
      }
      setProducts(products);
    });
  }

  return (
    <>
      <NavBar />
      <h1>Listings</h1>
      <div className="listings Container">

        {products.map(product => (
          <div key={product.id} className="product">
            <h2>{product.name}</h2>
            <p>{product.desc}</p>
            <p>{product.price}</p>
          </div>
        ))}
      </div>
    </>
  )
}

export default Listings;