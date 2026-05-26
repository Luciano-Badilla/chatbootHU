import React from "react";
import { Head } from "@inertiajs/react";

export default function Welcome() {
  return (
    <>
      <Head title="Welcome" />
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 text-gray-800">
        <h1 className="text-4xl font-bold mb-4">🚀 Laravel + React + Inertia</h1>
        <p className="text-lg text-gray-600">
          Bienvenido a tu template base. 
        </p>
      </div>
    </>
  );
}