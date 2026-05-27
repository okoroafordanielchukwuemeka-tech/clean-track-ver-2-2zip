import app from "./app.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API server running on port ${PORT}`);
});
