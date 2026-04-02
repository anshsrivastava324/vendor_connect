class SupplierDashboard {
    constructor() {
        this.currentUser = null;
        this.userProfile = null;
        this.inventory = [];
        this.orders = [];
        this.vendorProfilesById = new Map();
        this.editingItemId = null;
        this.markingItemInStock = false;
        
        this.init();
    }

    async init() {
        this.currentUser = supabase.auth.getCurrentUser();
        this.userProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');

        if (!this.currentUser || this.userProfile.user_type !== 'supplier') {
            window.location.href = 'supplier-login.html';
            return;
        }

        this.setupEventListeners();
        this.updateUserDisplay();
        await this.loadData();
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                this.switchTab(tab);
            });
        });

        // Add item form
        document.getElementById('addItemForm').addEventListener('submit', (e) => this.addItem(e));

        // Profile form
        document.getElementById('profileForm').addEventListener('submit', (e) => this.updateProfile(e));

        // Inventory search
        document.getElementById('inventorySearch').addEventListener('input', (e) => this.filterInventory());
        document.getElementById('inventorySearchBtn').addEventListener('click', () => this.filterInventory());
        document.getElementById('inventorySearch').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.filterInventory();
            }
        });
        document.getElementById('categoryFilter').addEventListener('change', (e) => this.filterInventory());
        document.getElementById('inventoryGrid').addEventListener('click', (e) => this.handleInventoryAction(e));

        // Order status filter
        document.getElementById('orderStatusFilter').addEventListener('change', (e) => this.filterOrders());

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
    }

    updateUserDisplay() {
        document.getElementById('userName').textContent = 
            this.userProfile.business_name || this.userProfile.name || 'Supplier';
    }

    switchTab(tabName) {
        // Update active menu item
        document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update active tab content
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.getElementById(`${tabName}Tab`).classList.add('active');

        // Load tab-specific data
        if (tabName === 'overview') {
            this.refreshOverviewData();
        }

        if (tabName === 'inventory') {
            this.loadInventory();
        }

        if (tabName === 'orders') {
            this.loadOrders();
        }

        if (tabName === 'profile') {
            this.loadProfileData();
        }
    }

    async loadData() {
        await this.refreshOverviewData();
    }

    async refreshOverviewData() {
        await this.loadInventory();
        await this.loadOrders();
        await this.updateStats();
    }

    async loadInventory() {
        try {
            this.inventory = await supabase.database
                .from('items')
                .select()
                .eq('supplier_id', this.currentUser.id)
                .execute();

            this.displayInventory();
        } catch (error) {
            console.error('Error loading inventory:', error);
        }
    }

    displayInventory() {
        const inventoryGrid = document.getElementById('inventoryGrid');
        
        if (this.inventory.length === 0) {
            inventoryGrid.innerHTML = '<div class="empty-inventory">No items in inventory. Add your first item!</div>';
            return;
        }

        inventoryGrid.innerHTML = this.inventory.map(item => `
            <div class="inventory-item">
                <div class="item-info">
                    <h4>${item.name}</h4>
                    <p class="item-category">${item.category}</p>
                    <p class="item-price">₹${item.price}/${item.unit}</p>
                    <p class="item-stock">Stock: ${item.stock_quantity}</p>
                    <p class="item-status ${item.in_stock ? 'in-stock' : 'out-of-stock'}">
                        ${item.in_stock ? 'In Stock' : 'Out of Stock'}
                    </p>
                </div>
                <div class="item-actions">
                    <button class="btn btn-small btn-primary" data-action="edit-item" data-item-id="${item.id}" onclick="supplierDashboard.editItem('${item.id}')">
                        Edit
                    </button>
                    ${item.in_stock
                        ? `<button class="btn btn-small btn-danger" data-action="mark-out-of-stock" data-item-id="${item.id}" onclick="supplierDashboard.toggleStock('${item.id}', false)">
                                Mark Out of Stock
                           </button>`
                        : `<button class="btn btn-small btn-success" data-action="mark-in-stock" data-item-id="${item.id}" onclick="supplierDashboard.markItemInStock('${item.id}')">
                                Mark In Stock
                           </button>`}
                </div>
            </div>
        `).join('');
    }

    async loadOrders() {
        try {
            this.orders = await supabase.database
                .from('orders')
                .select('*,vendor:user_profiles!vendor_id(name,phone),order_items(*)')
                .eq('supplier_id', this.currentUser.id)
                .execute();

            const vendorIds = [...new Set(this.orders.map(order => order.vendor_id).filter(Boolean))];
            this.vendorProfilesById = new Map();

            if (vendorIds.length > 0) {
                const vendorProfiles = await supabase.database
                    .from('user_profiles')
                    .select('id,name,phone,business_name,user_type')
                    .eq('user_type', 'vendor')
                    .execute();

                vendorProfiles
                    .filter(profile => vendorIds.includes(profile.id))
                    .forEach(profile => {
                        this.vendorProfilesById.set(profile.id, profile);
                    });
            }

            this.displayOrders();
            this.updateOrdersCount();
        } catch (error) {
            console.error('Error loading orders:', error);
        }
    }

    getVendorDisplayName(order) {
        const profile = this.vendorProfilesById.get(order.vendor_id) || order.vendor || null;
        return profile?.name || profile?.business_name || 'Vendor details unavailable';
    }

    getVendorDisplayPhone(order) {
        const profile = this.vendorProfilesById.get(order.vendor_id) || order.vendor || null;
        return profile?.phone || 'Vendor phone unavailable';
    }

    renderStatusControl(order) {
        if (order.status === 'delivered') {
            return `
                <div class="order-status">
                    <span class="status-delivered">Delivered</span>
                </div>
            `;
        }
        return `
            <div class="order-status">
                <select class="status-select" id="statusSelect-${order.id}" data-order-id="${order.id}">
                    <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                    <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>Preparing</option>
                    <option value="ready" ${order.status === 'ready' ? 'selected' : ''}>Ready</option>
                    <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                </select>
                <button class="btn btn-small btn-primary update-status-btn" data-order-id="${order.id}" onclick="supplierDashboard.updateOrderStatus('${order.id}', document.getElementById('statusSelect-${order.id}').value)">
                    Update Status
                </button>
            </div>
        `;
    }

    displayOrders() {
        const ordersList = document.getElementById('ordersList');
        
        if (this.orders.length === 0) {
            ordersList.innerHTML = '<div class="empty-orders">No orders received yet</div>';
            return;
        }

        ordersList.innerHTML = this.orders.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <div class="order-info">
                        <h4>Order #${order.order_number || order.id.substring(0, 8)}</h4>
                        <p>From: ${this.getVendorDisplayName(order)}</p>
                        <p>Phone: ${this.getVendorDisplayPhone(order)}</p>
                    </div>
                    ${this.renderStatusControl(order)}
                </div>
                <div class="order-details">
                    <p><strong>Total: ₹${order.total_amount}</strong></p>
                    <p>Date: ${new Date(order.created_at).toLocaleDateString()}</p>
                    <p>Items: ${order.order_items?.length || 0}</p>
                    ${order.notes ? `<p>Notes: ${order.notes}</p>` : ''}
                </div>
                <div class="order-items">
                    <div class="order-items-header">
                        <span class="col-item">Item</span>
                        <span class="col-quantity">Quantity</span>
                        <span class="col-price">Price</span>
                        <span class="col-total">Total</span>
                    </div>
                    ${order.order_items?.map(item => {
                        const itemTotal = (Number(item.quantity) * Number(item.price)).toFixed(2);
                        return `
                        <div class="order-item">
                            <span class="col-item">${item.item_name}</span>
                            <span class="col-quantity">${item.quantity} ${item.unit}</span>
                            <span class="col-price">₹${Number(item.price).toFixed(2)}</span>
                            <span class="col-total">₹${itemTotal}</span>
                        </div>
                    `}).join('') || ''}
                </div>
            </div>
        `).join('');
    }

    updateOrdersCount() {
        const pendingCount = this.orders.filter(order => order.status === 'pending').length;
        document.getElementById('ordersCount').textContent = pendingCount;
    }

    async updateStats() {
        try {
            const totalItems = this.inventory.length;
            const pendingOrders = this.orders.filter(order => order.status === 'pending').length;
            const completedOrders = this.orders.filter(order => order.status === 'delivered').length;
            const totalRevenue = this.orders
                .filter(order => order.status === 'delivered')
                .reduce((sum, order) => sum + order.total_amount, 0);

            document.getElementById('totalItems').textContent = totalItems;
            document.getElementById('pendingOrders').textContent = pendingOrders;
            document.getElementById('completedOrders').textContent = completedOrders;
            document.getElementById('totalRevenue').textContent = `₹${totalRevenue.toFixed(2)}`;

            // Display recent orders
            const recentOrders = this.orders.slice(0, 3);
            document.getElementById('recentOrders').innerHTML = recentOrders.map(order => `
                <div class="recent-order">
                    <span>Order #${order.order_number || order.id.substring(0, 8)}</span>
                    <span>₹${order.total_amount}</span>
                    <span class="status-${order.status}">${order.status}</span>
                </div>
            `).join('') || '<p>No recent orders</p>';
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    async addItem(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const addItemText = document.getElementById('addItemText');
        const addItemSpinner = document.getElementById('addItemSpinner');
        const itemId = formData.get('item_id');

        // Show loading state
        addItemText.classList.add('hidden');
        addItemSpinner.classList.remove('hidden');

        try {
            const stockQuantity = parseInt(formData.get('stock_quantity')) || 0;
            const itemData = {
                name: formData.get('name'),
                category: formData.get('category'),
                price: parseFloat(formData.get('price')),
                unit: formData.get('unit'),
                description: formData.get('description'),
                stock_quantity: stockQuantity,
                minimum_order: parseInt(formData.get('minimum_order')) || 1,
                supplier_id: this.currentUser.id,
                in_stock: this.markingItemInStock ? stockQuantity > 0 : stockQuantity > 0
            };

            if (itemId) {
                await supabase.database
                    .from('items')
                    .update(itemData)
                    .eq('id', itemId)
                    .eq('supplier_id', this.currentUser.id)
                    .execute();
                alert('Item updated successfully!');
            } else {
                await supabase.database.from('items').insert(itemData);
                alert('Item added successfully!');
            }

            e.target.reset();
            this.resetItemForm();
            await this.loadInventory();
            this.switchTab('inventory');
        } catch (error) {
            console.error('Error adding item:', error);
            alert('Failed to add item');
        } finally {
            addItemText.classList.remove('hidden');
            addItemSpinner.classList.add('hidden');
        }
    }

    async toggleStock(itemId, inStock) {
        try {
            await supabase.database
                .from('items')
                .update({ in_stock: inStock })
                .eq('id', itemId)
                .execute();

            await this.loadInventory();
        } catch (error) {
            console.error('Error updating stock status:', error);
        }
    }

    async updateOrderStatus(orderId, status) {
        try {
            // Get the current order to check previous status
            const currentOrder = this.orders.find(o => o.id === orderId);
            const previousStatus = currentOrder?.status;

            // Status hierarchy: pending < confirmed < preparing < ready < delivered
            const statusHierarchy = { 'pending': 0, 'confirmed': 1, 'preparing': 2, 'ready': 3, 'delivered': 4 };
            const previousLevel = statusHierarchy[previousStatus] || -1;
            const newLevel = statusHierarchy[status] || -1;

            // If transitioning to confirmed or higher for the first time, deduct inventory
            if (newLevel >= 1 && previousLevel < 1) {
                await this.deductOrderInventory(orderId);
            }

            await supabase.database
                .from('orders')
                .update({ status })
                .eq('id', orderId)
                .execute();

            await this.loadOrders();
            await this.loadInventory();
            await this.updateStats();
        } catch (error) {
            console.error('Error updating order status:', error);
            alert('Failed to update order status. Please try again.');
        }
    }

    async deductOrderInventory(orderId) {
        try {
            // Get the order with its items
            const orderResult = await supabase.database
                .from('orders')
                .select('*,order_items(*)')
                .eq('id', orderId)
                .single()
                .execute();

            if (!orderResult || !orderResult.order_items) {
                console.warn('Order or order items not found');
                return;
            }

            const supplierId = orderResult.supplier_id || null;
            const supplierItems = supplierId
                ? await supabase.database
                    .from('items')
                    .select('id,name,stock_quantity,in_stock,supplier_id')
                    .eq('supplier_id', supplierId)
                    .execute()
                : [];

            // Deduct each item from inventory
            for (const orderItem of orderResult.order_items) {
                if (orderItem.item_id && orderItem.supplier_id) {
                    try {
                        // Get current stock
                        const itemResult = await supabase.database
                            .from('items')
                            .select('stock_quantity')
                            .eq('id', orderItem.item_id)
                            .eq('supplier_id', orderItem.supplier_id)
                            .single()
                            .execute();

                        if (itemResult) {
                            const currentStock = Number(itemResult.stock_quantity || 0);
                            const quantityOrdered = Number(orderItem.quantity || 0);
                            const nextStock = Math.max(0, currentStock - quantityOrdered);

                            // Update inventory
                            await supabase.database
                                .from('items')
                                .update({
                                    stock_quantity: nextStock,
                                    in_stock: nextStock > 0
                                })
                                .eq('id', orderItem.item_id)
                                .eq('supplier_id', orderItem.supplier_id)
                                .execute();

                            console.log(`Deducted ${quantityOrdered} units from item ${orderItem.item_id}. New stock: ${nextStock}`);
                        }
                    } catch (err) {
                        console.error(`Error deducting inventory for item ${orderItem.item_id}:`, err);
                    }
                } else if (supplierId && orderItem.item_name) {
                    try {
                        const matchedItem = this.findMatchingSupplierItem(orderItem.item_name, supplierItems);

                        if (!matchedItem) {
                            console.warn(`No supplier inventory match found for order item: ${orderItem.item_name}`);
                            continue;
                        }

                        const currentStock = Number(matchedItem.stock_quantity || 0);
                        const quantityOrdered = Number(orderItem.quantity || 0);
                        const nextStock = Math.max(0, currentStock - quantityOrdered);

                        await supabase.database
                            .from('items')
                            .update({
                                stock_quantity: nextStock,
                                in_stock: nextStock > 0
                            })
                            .eq('id', matchedItem.id)
                            .eq('supplier_id', supplierId)
                            .execute();

                        console.log(`Deducted ${quantityOrdered} units from ${matchedItem.name}. New stock: ${nextStock}`);
                    } catch (err) {
                        console.error(`Error deducting inventory by name for ${orderItem.item_name}:`, err);
                    }
                }
            }

            // Ensure items that reached zero are explicitly marked out of stock.
            const latestSupplierItems = supplierId
                ? await supabase.database
                    .from('items')
                    .select('id,stock_quantity')
                    .eq('supplier_id', supplierId)
                    .execute()
                : [];

            for (const item of latestSupplierItems) {
                const stockQty = Number(item.stock_quantity || 0);
                await supabase.database
                    .from('items')
                    .update({ in_stock: stockQty > 0 })
                    .eq('id', item.id)
                    .eq('supplier_id', supplierId)
                    .execute();
            }
        } catch (error) {
            console.error('Error deducting order inventory:', error);
        }
    }

    findMatchingSupplierItem(orderItemName, supplierItems) {
        const normalizedOrderName = this.normalizeText(orderItemName);
        if (!normalizedOrderName || !Array.isArray(supplierItems)) {
            return null;
        }

        const exactMatch = supplierItems.find(item => this.normalizeText(item.name) === normalizedOrderName);
        if (exactMatch) return exactMatch;

        const singularOrderName = normalizedOrderName.replace(/s$/, '');
        const singularMatch = supplierItems.find(item => this.normalizeText(item.name).replace(/s$/, '') === singularOrderName);
        if (singularMatch) return singularMatch;

        const partialMatch = supplierItems.find(item => {
            const normalizedItemName = this.normalizeText(item.name);
            return normalizedItemName.includes(normalizedOrderName) || normalizedOrderName.includes(normalizedItemName);
        });

        return partialMatch || null;
    }

    normalizeText(value) {
        return String(value || '').trim().toLowerCase();
    }

    filterInventory() {
        const search = document.getElementById('inventorySearch').value.toLowerCase();
        const category = document.getElementById('categoryFilter').value;

        let filtered = this.inventory;

        if (search) {
            filtered = filtered.filter(item => 
                item.name.toLowerCase().includes(search) ||
                item.description?.toLowerCase().includes(search)
            );
        }

        if (category) {
            filtered = filtered.filter(item => item.category === category);
        }

        const inventoryGrid = document.getElementById('inventoryGrid');
        inventoryGrid.innerHTML = filtered.map(item => `
            <div class="inventory-item">
                <div class="item-info">
                    <h4>${item.name}</h4>
                    <p class="item-category">${item.category}</p>
                    <p class="item-price">₹${item.price}/${item.unit}</p>
                    <p class="item-stock">Stock: ${item.stock_quantity}</p>
                    <p class="item-status ${item.in_stock ? 'in-stock' : 'out-of-stock'}">
                        ${item.in_stock ? 'In Stock' : 'Out of Stock'}
                    </p>
                </div>
                <div class="item-actions">
                    <button class="btn btn-small btn-primary" data-action="edit-item" data-item-id="${item.id}" onclick="supplierDashboard.editItem('${item.id}')">
                        Edit
                    </button>
                    ${item.in_stock
                        ? `<button class="btn btn-small btn-danger" data-action="mark-out-of-stock" data-item-id="${item.id}" onclick="supplierDashboard.toggleStock('${item.id}', false)">
                                Mark Out of Stock
                           </button>`
                        : `<button class="btn btn-small btn-success" data-action="mark-in-stock" data-item-id="${item.id}" onclick="supplierDashboard.markItemInStock('${item.id}')">
                                Mark In Stock
                           </button>`}
                </div>
            </div>
        `).join('');
    }

    handleInventoryAction(e) {
        const actionButton = e.target.closest('button[data-action]');
        if (!actionButton) {
            return;
        }

        const { action, itemId } = actionButton.dataset;

        if (action === 'edit-item') {
            this.editItem(itemId);
        }

        if (action === 'mark-out-of-stock') {
            this.toggleStock(itemId, false);
        }

        if (action === 'mark-in-stock') {
            this.markItemInStock(itemId);
        }
    }

    filterOrders() {
        const status = document.getElementById('orderStatusFilter').value;
        
        let filtered = this.orders;
        if (status) {
            filtered = filtered.filter(order => order.status === status);
        }

        // Re-display filtered orders (similar to displayOrders but with filtered array)
        const ordersList = document.getElementById('ordersList');
        ordersList.innerHTML = filtered.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <div class="order-info">
                        <h4>Order #${order.order_number || order.id.substring(0, 8)}</h4>
                        <p>From: ${this.getVendorDisplayName(order)}</p>
                        <p>Phone: ${this.getVendorDisplayPhone(order)}</p>
                    </div>
                    ${this.renderStatusControl(order)}
                </div>
                <div class="order-details">
                    <p><strong>Total: ₹${order.total_amount}</strong></p>
                    <p>Date: ${new Date(order.created_at).toLocaleDateString()}</p>
                    <p>Items: ${order.order_items?.length || 0}</p>
                    ${order.notes ? `<p>Notes: ${order.notes}</p>` : ''}
                </div>
                <div class="order-items">
                    <div class="order-items-header">
                        <span class="col-item">Item</span>
                        <span class="col-quantity">Quantity</span>
                        <span class="col-price">Price</span>
                        <span class="col-total">Total</span>
                    </div>
                    ${order.order_items?.map(item => {
                        const itemTotal = (Number(item.quantity) * Number(item.price)).toFixed(2);
                        return `
                        <div class="order-item">
                            <span class="col-item">${item.item_name}</span>
                            <span class="col-quantity">${item.quantity} ${item.unit}</span>
                            <span class="col-price">₹${Number(item.price).toFixed(2)}</span>
                            <span class="col-total">₹${itemTotal}</span>
                        </div>
                    `}).join('') || ''}
                </div>
            </div>
        `).join('');
    }

    loadProfileData() {
        document.getElementById('profileName').value = this.userProfile.name || '';
        document.getElementById('profilePhone').value = this.userProfile.phone || '';
        document.getElementById('profileBusinessName').value = this.userProfile.business_name || '';
        document.getElementById('profileStreet').value = this.userProfile.address_street || '';
        document.getElementById('profileCity').value = this.userProfile.address_city || '';
        document.getElementById('profileState').value = this.userProfile.address_state || '';
        document.getElementById('profilePincode').value = this.userProfile.address_pincode || '';
    }

    async updateProfile(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);

        try {
            const updateData = {
                name: formData.get('name'),
                phone: formData.get('phone'),
                business_name: formData.get('business_name'),
                address_street: formData.get('address_street'),
                address_city: formData.get('address_city'),
                address_state: formData.get('address_state'),
                address_pincode: formData.get('address_pincode')
            };

            await supabase.database
                .from('user_profiles')
                .update(updateData)
                .eq('id', this.currentUser.id)
                .execute();

            // Update local profile
            this.userProfile = { ...this.userProfile, ...updateData };
            localStorage.setItem('user_profile', JSON.stringify(this.userProfile));
            
            alert('Profile updated successfully!');
            this.updateUserDisplay();
        } catch (error) {
            console.error('Error updating profile:', error);
            alert('Failed to update profile');
        }
    }

    editItem(itemId) {
        const item = this.inventory.find(i => String(i.id) === String(itemId));
        if (item) {
            this.openInventoryForm(item, false);
        } else {
            console.warn('Edit item not found in inventory:', itemId);
        }
    }

    markItemInStock(itemId) {
        const item = this.inventory.find(i => String(i.id) === String(itemId));
        if (item) {
            this.openInventoryForm(item, true);
        } else {
            console.warn('Mark in stock item not found in inventory:', itemId);
        }
    }

    openInventoryForm(item, markInStock = false) {
        this.editingItemId = item.id;
        this.markingItemInStock = markInStock;

        const itemIdField = document.getElementById('itemId');
        const itemNameField = document.getElementById('itemName');
        const itemCategoryField = document.getElementById('itemCategory');
        const itemPriceField = document.getElementById('itemPrice');
        const itemUnitField = document.getElementById('itemUnit');
        const itemDescriptionField = document.getElementById('itemDescription');
        const stockQuantityField = document.getElementById('stockQuantity');
        const minimumOrderField = document.getElementById('minimumOrder');
        const addItemTextField = document.getElementById('addItemText');

        if (!itemIdField || !itemNameField || !itemCategoryField || !itemPriceField || !itemUnitField || !itemDescriptionField || !stockQuantityField || !minimumOrderField || !addItemTextField) {
            console.error('Add item form fields are missing. Cannot prefill inventory form.');
            return;
        }

        itemIdField.value = item.id;
        itemNameField.value = item.name || '';
        itemCategoryField.value = (item.category || '').toLowerCase();
        itemPriceField.value = item.price ?? '';
        itemUnitField.value = item.unit || '';
        itemDescriptionField.value = item.description || '';
        stockQuantityField.value = item.stock_quantity ?? 0;
        minimumOrderField.value = item.minimum_order ?? 1;
        addItemTextField.textContent = markInStock ? 'Update & Mark In Stock' : 'Update Item';

        this.switchTab('add-item');
        const addItemForm = document.getElementById('addItemForm');
        if (addItemForm) {
            addItemForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    resetItemForm() {
        this.editingItemId = null;
        this.markingItemInStock = false;
        document.getElementById('itemId').value = '';
        document.getElementById('addItemText').textContent = 'Add Item';
    }

    async updateItemPrice(itemId, newPrice) {
        try {
            await supabase.database
                .from('items')
                .update({ price: newPrice })
                .eq('id', itemId)
                .execute();

            await this.loadInventory();
        } catch (error) {
            console.error('Error updating item price:', error);
        }
    }

    async logout() {
        if (confirm('Are you sure you want to logout?')) {
            await supabase.auth.signOut();
            window.location.href = 'index.html';
        }
    }
}

// Initialize dashboard when page loads
let supplierDashboard;
document.addEventListener('DOMContentLoaded', () => {
    supplierDashboard = new SupplierDashboard();
    window.supplierDashboard = supplierDashboard;
});
