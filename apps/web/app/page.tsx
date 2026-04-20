export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        fontFamily: "Inter, system-ui, sans-serif",
        backgroundColor: "#FAFAF9",
        color: "#1A1A1A",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", fontWeight: 500, marginBottom: "0.5rem" }}>
        PettahPro
      </h1>
      <p style={{ color: "#7FB89A", fontSize: "1.125rem" }}>
        Accounting for how Sri Lanka actually does business.
      </p>
      <p style={{ marginTop: "2rem", fontSize: "0.875rem", opacity: 0.6 }}>
        Build starts here.
      </p>
    </main>
  );
}
