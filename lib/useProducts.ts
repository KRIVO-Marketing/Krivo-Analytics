"use client";
import { useEffect, useState } from "react";
import { fetchProducts } from "./data";
import { getProducts, type Product } from "./delivery";

// Lista de produtos da Entrega, vinda do catálogo. Re-renderiza quando o catálogo carrega.
export function useProducts(): Product[] {
  const [list, setList] = useState<Product[]>(getProducts());
  useEffect(() => {
    let alive = true;
    fetchProducts().then(() => alive && setList(getProducts())).catch(() => {});
    return () => { alive = false; };
  }, []);
  return list;
}
