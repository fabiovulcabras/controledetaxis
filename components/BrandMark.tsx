import Image from "next/image";

export default function BrandMark() {
  return (
    <Image
      className="brand-mark"
      src="/logo-v.png"
      alt="Marca Vulcabras"
      width={48}
      height={48}
      style={{ backgroundColor: "#fff", objectFit: "contain" }}
    />
  );
}