CREATE TABLE "saved_colors" (
	"organization_id" uuid NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_colors_organization_id_color_pk" PRIMARY KEY("organization_id","color")
);
--> statement-breakpoint
ALTER TABLE "saved_colors" ADD CONSTRAINT "saved_colors_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;