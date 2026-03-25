# eStore Database Setup Guide

## Overview
This guide provides complete MySQL database scripts for your eStore Node.js shopping application.

## Files Created
1. **estore_database_setup.sql** - Main database schema and initial setup
2. **estore_sample_data.sql** - Sample data for testing and development
3. **estore_maintenance.sql** - Backup, optimization, and maintenance scripts

## Database Schema

### Tables Created:
- **users** - Customer accounts and authentication
- **categories** - Hierarchical product categories
- **products** - Product catalog with pricing and inventory
- **productimages** - Multiple images per product
- **orders** - Customer orders and shipping information
- **orderdetails** - Line items for each order

### Key Features:
- Hierarchical categories (main categories + subcategories)
- Multiple product images with display order
- Order tracking with status management
- Foreign key constraints for data integrity
- Triggers for automatic order total calculation
- Views for common queries
- Stored procedures for complex operations

## Setup Instructions

### 1. Database Setup
```bash
# Connect to MySQL
mysql -u root -p

# Run the main setup script
source estore_database_setup.sql;

# Run sample data insertion (optional)
source estore_sample_data.sql;
```

### 2. Update Your Node.js Configuration
Update your `shared/pool.js` to match your MySQL credentials:

```javascript
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "your_mysql_password", // Update this
  database: "estore1",
  port: 3306,
  multipleStatements: true,
});
```

### 3. Test the Database
```sql
-- Test basic queries
SELECT COUNT(*) as total_products FROM products;
SELECT COUNT(*) as total_categories FROM categories;
SELECT COUNT(*) as total_users FROM users;
```

## API Endpoints Supported

### Users
- `POST /users/signup` - User registration
- `POST /users/login` - User authentication

### Products
- `GET /products` - Get products with filters
- `GET /products?maincategoryid=X` - Filter by main category
- `GET /products?subcategoryid=X` - Filter by subcategory
- `GET /products?keyword=search` - Search products

### Categories
- `GET /productCategories` - Get all categories

### Orders
- `POST /orders/add` - Create new order (requires auth)
- `GET /orders/allorders?userEmail=X` - Get user orders (requires auth)
- `GET /orders/orderproducts?orderId=X` - Get order details (requires auth)

## Sample Data Included

### Categories (Main + Subcategories):
- Electronics (Mobile Phones, Laptops, Tablets, Headphones, Smart Watches)
- Clothing (Men's, Women's, Kids, Shoes, Accessories)
- Books (Fiction, Non-Fiction, Science Fiction, Biography, Cooking)
- Home & Kitchen (Kitchen Appliances, Home Decor, Furniture, Cleaning)
- Sports (Fitness, Outdoor Sports, Gaming, Cycling)

### Sample Products:
- iPhone 15 Pro, Samsung Galaxy S24, MacBook Pro
- Various clothing items for all categories
- Books including classics and bestsellers
- Home appliances and furniture
- Sports equipment and gaming consoles

### Sample Users:
- 4 test users with bcrypt-hashed passwords (password: "password123")

### Sample Orders:
- 4 sample orders with different statuses
- Order details showing product quantities and amounts

## Advanced Features

### Views for Common Queries:
- `products_with_images` - Products with aggregated image galleries
- `order_summary` - Orders with user details

### Stored Procedures:
- `GetProductsByCategory()` - Get products by category with search
- `GetOrderDetails()` - Get detailed order information

### Triggers:
- Automatic order total calculation when order details change
- Maintains data integrity across related tables

### Indexes for Performance:
- Optimized indexes for common query patterns
- Composite indexes for multi-column searches

## Maintenance

### Regular Tasks:
```sql
-- Run maintenance script
source estore_maintenance.sql;

-- Backup database
mysqldump -u root -p estore1 > estore_backup_$(date +%Y%m%d).sql

-- Check table optimization
OPTIMIZE TABLE products, orders, users;
```

### Performance Monitoring:
- Use the maintenance script for performance checks
- Monitor query performance with slow query log
- Check table sizes and index usage

## Security Considerations

### Password Hashing:
All user passwords are bcrypt-hashed with salt rounds of 10.

### Database Users:
Consider creating separate users for different purposes:
- `estore_app` - Application user with full CRUD permissions
- `estore_readonly` - Read-only user for reporting

### Input Validation:
Your Node.js application should validate all inputs before database operations.

## Troubleshooting

### Common Issues:
1. **Connection Errors** - Check MySQL credentials in pool.js
2. **Foreign Key Constraints** - Ensure data integrity when inserting
3. **Missing Images** - Products without images will return empty arrays

### Debug Queries:
```sql
-- Check if products have images
SELECT p.product_name, COUNT(pi.id) as image_count
FROM products p
LEFT JOIN productimages pi ON p.id = pi.product_id
GROUP BY p.id;

-- Check category hierarchy
SELECT c1.name as parent, c2.name as child
FROM categories c1
JOIN categories c2 ON c1.id = c2.parent_category_id;
```

## Next Steps

1. **Run the setup scripts** to create your database
2. **Update your Node.js configuration** with correct MySQL credentials
3. **Test all API endpoints** with the sample data
4. **Customize the schema** based on your specific requirements
5. **Set up regular backups** using the maintenance scripts

The database schema is designed to support your existing Node.js backend with no code changes required.
