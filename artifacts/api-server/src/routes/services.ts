import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { services, orderItems, orders, serviceBranches, branches } from "@workspace/db/schema";
import { eq, and, ne, sql, asc, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";