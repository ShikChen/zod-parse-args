import { z } from "zod";
import { parseArgs } from "zod-parse-args";

const { name, times, loud } = parseArgs(
  z.object({
    name: z.string().describe("Name to greet"),
    times: z.number().default(1).describe("Number of repetitions"),
    loud: z.boolean().describe("Print in uppercase"),
  }),
  { name: "greet", version: "1.0.0" },
);

for (let i = 0; i < times; i++) {
  const greeting = `Hello, ${name}!`;
  console.log(loud ? greeting.toUpperCase() : greeting);
}
