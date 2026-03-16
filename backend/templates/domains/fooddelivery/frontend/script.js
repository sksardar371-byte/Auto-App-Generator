(function () {
  var storageKeys = {
    cart: "foodrush_cart_v1",
    orders: "foodrush_orders_v1",
    notes: "foodrush_notes_v1",
    ownerMenu: "foodrush_owner_menu_v1",
  };

  var apiBase =
    localStorage.getItem("API_BASE_URL") ||
    (location.protocol === "file:" ? "http://localhost:5000/api" : location.origin + "/api");
  window.APP_API_BASE = String(apiBase || "/api").replace(/\/+$/, "");

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getUser() {
    return readJson("user", {});
  }

  function normalizeRole(rawRole) {
    var role = String(rawRole || "")
      .toLowerCase()
      .replace(/\s+/g, "_");

    var aliases = {
      customer: "customer",
      user: "customer",
      client: "customer",
      student: "customer",
      admin: "admin",
      administrator: "admin",
      superadmin: "admin",
      restaurant_owner: "restaurant_owner",
      restaurantowner: "restaurant_owner",
      owner: "restaurant_owner",
      vendor: "restaurant_owner",
      delivery_partner: "delivery_partner",
      deliverypartner: "delivery_partner",
      delivery_agent: "delivery_partner",
      deliveryagent: "delivery_partner",
      rider: "delivery_partner",
      agent: "delivery_partner",
    };

    return aliases[role] || role || "guest";
  }

  function getRole() {
    return normalizeRole(getUser().role || "guest");
  }

  function hasSession() {
    return Boolean(localStorage.getItem("token"));
  }

  function getPageName() {
    var path = (location.pathname || "").split(/[\\/]/).pop();
    return String(path || "index.html").toLowerCase();
  }

  function getRoleHome(role) {
    if (role === "restaurant_owner") return "owner-dashboard.html";
    if (role === "delivery_partner") return "delivery-dashboard.html";
    if (role === "admin") return "admin-dashboard.html";
    return "index.html";
  }

  function isRoleAllowed(role, allowedRoles) {
    return Array.isArray(allowedRoles) && allowedRoles.indexOf(role) >= 0;
  }

  function getCart() {
    var items = readJson(storageKeys.cart, []);
    return Array.isArray(items) ? items : [];
  }

  function saveCart(items) {
    writeJson(storageKeys.cart, items || []);
  }

  function getOrders() {
    var orders = readJson(storageKeys.orders, []);
    return Array.isArray(orders) ? orders : [];
  }

  function saveOrders(orders) {
    writeJson(storageKeys.orders, orders || []);
  }

  function getOwnerMenu() {
    var items = readJson(storageKeys.ownerMenu, []);
    return Array.isArray(items) ? items : [];
  }

  function saveOwnerMenu(items) {
    writeJson(storageKeys.ownerMenu, items || []);
  }

  function formatMoney(amount) {
    var num = Number(amount || 0);
    return "Rs " + (Number.isFinite(num) ? num.toFixed(0) : "0");
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function cartStats() {
    var items = getCart();
    var itemCount = items.reduce(function (sum, item) {
      return sum + Number(item.qty || 0);
    }, 0);
    var itemsTotal = items.reduce(function (sum, item) {
      return sum + Number(item.price || 0) * Number(item.qty || 0);
    }, 0);
    var deliveryFee = items.length ? 30 : 0;
    return {
      itemCount: itemCount,
      itemsTotal: itemsTotal,
      deliveryFee: deliveryFee,
      grandTotal: itemsTotal + deliveryFee,
    };
  }

  function toast(message) {
    var node = document.createElement("div");
    node.className = "toast-top";
    node.textContent = message;
    document.body.appendChild(node);
    requestAnimationFrame(function () {
      node.classList.add("show");
    });
    setTimeout(function () {
      node.classList.remove("show");
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 260);
    }, 1800);
  }

  function addToCart(item) {
    if (!hasSession()) {
      toast("Please login to add items to cart");
      setTimeout(function () {
        location.href = "login.html";
      }, 450);
      return;
    }

    var role = getRole();
    if (role !== "customer" && role !== "admin") {
      toast("Only customer role can place orders");
      return;
    }

    var cart = getCart();
    var key = slugify(item.name);
    var existing = cart.find(function (entry) {
      return entry.key === key;
    });
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({
        key: key,
        name: item.name,
        price: Number(item.price || 0),
        restaurant: item.restaurant || "FoodRush Kitchen",
        image: item.image || "",
        qty: 1,
      });
    }
    saveCart(cart);
    syncCartBadges();
    toast(item.name + " added to cart");
  }

  function syncCartBadges() {
    var stats = cartStats();
    var navCart = document.querySelector(".top-nav .nav-inner > a[href='cart.html']");
    if (navCart) navCart.textContent = "Cart (" + stats.itemCount + ")";
    var floating = document.getElementById("floatingCart");
    if (floating) {
      floating.textContent = stats.itemCount
        ? stats.itemCount + " Items | " + formatMoney(stats.grandTotal) + " | View Cart"
        : "Cart is empty | View Cart";
    }
  }

  function clearNavButtons(nav) {
    Array.prototype.slice.call(nav.children).forEach(function (child) {
      if (child.tagName === "A" && child.classList.contains("btn")) child.remove();
      if (child.tagName === "BUTTON" && child.classList.contains("btn")) child.remove();
      if (child.tagName === "SPAN" && child.classList.contains("chip") && child.classList.contains("user-chip")) child.remove();
    });
  }

  function navLink(text, href, type) {
    var link = document.createElement("a");
    link.className = "btn " + (type || "ghost");
    link.href = href;
    link.textContent = text;
    return link;
  }

  function ensureTopNav() {
    var nav = document.querySelector(".top-nav .nav-inner");
    if (!nav) return;
    clearNavButtons(nav);

    var page = getPageName();
    if (!hasSession()) {
      if (page === "login.html") {
        nav.appendChild(navLink("Home", "index.html", "ghost"));
        nav.appendChild(navLink("Register", "register.html", "primary"));
      } else if (page === "register.html") {
        nav.appendChild(navLink("Home", "index.html", "ghost"));
        nav.appendChild(navLink("Login", "login.html", "primary"));
      } else {
        nav.appendChild(navLink("Login", "login.html", "ghost"));
        nav.appendChild(navLink("Register", "register.html", "primary"));
      }
      return;
    }

    var role = getRole();
    var links = [];
    if (role === "restaurant_owner") {
      links = [["Home", "index.html"], ["Owner", "owner-dashboard.html"], ["Orders", "order-tracking.html"]];
    } else if (role === "delivery_partner") {
      links = [["Home", "index.html"], ["Delivery", "delivery-dashboard.html"], ["Orders", "order-tracking.html"]];
    } else if (role === "admin") {
      links = [
        ["Home", "index.html"],
        ["Restaurants", "restaurants.html"],
        ["Admin", "admin-dashboard.html"],
        ["Owner", "owner-dashboard.html"],
        ["Delivery", "delivery-dashboard.html"],
        ["Orders", "order-tracking.html"],
      ];
    } else {
      links = [
        ["Home", "index.html"],
        ["Restaurants", "restaurants.html"],
        ["Cart (" + cartStats().itemCount + ")", "cart.html"],
        ["Orders", "order-tracking.html"],
        ["Profile", "profile.html"],
      ];
    }

    links.forEach(function (pair) {
      nav.appendChild(navLink(pair[0], pair[1], "ghost"));
    });

    var user = getUser();
    var userChip = document.createElement("span");
    userChip.className = "chip user-chip";
    userChip.textContent = String(user.name || user.email || role);
    nav.appendChild(userChip);

    var logoutBtn = document.createElement("button");
    logoutBtn.className = "btn primary";
    logoutBtn.type = "button";
    logoutBtn.textContent = "Logout";
    logoutBtn.addEventListener("click", function () {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      toast("Logged out");
      setTimeout(function () {
        location.href = "index.html";
      }, 350);
    });
    nav.appendChild(logoutBtn);
  }

  function protectPages() {
    var page = getPageName();
    var requiresAuth = new Set([
      "cart.html",
      "checkout.html",
      "profile.html",
      "order-tracking.html",
      "owner-dashboard.html",
      "delivery-dashboard.html",
      "admin-dashboard.html",
    ]);
    if (requiresAuth.has(page) && !hasSession()) {
      location.href = "login.html";
      return false;
    }
    if ((page === "login.html" || page === "register.html") && hasSession()) {
      location.href = "index.html";
      return false;
    }

    if (!hasSession()) return true;
    var role = getRole();
    var roleMatrix = {
      "cart.html": ["customer", "admin"],
      "checkout.html": ["customer", "admin"],
      "profile.html": ["customer", "admin"],
      "owner-dashboard.html": ["restaurant_owner", "admin"],
      "delivery-dashboard.html": ["delivery_partner", "admin"],
      "admin-dashboard.html": ["admin"],
      "order-tracking.html": ["customer", "delivery_partner", "admin"],
    };
    var allowed = roleMatrix[page];
    if (allowed && !isRoleAllowed(role, allowed)) {
      toast("Access restricted for your role");
      setTimeout(function () {
        location.href = getRoleHome(role);
      }, 380);
      return false;
    }
    return true;
  }

  function bindAddToCartButtons() {
    var buttons = document.querySelectorAll("[data-add-item]");
    var role = getRole();
    var blocked = hasSession() && role !== "customer" && role !== "admin";
    buttons.forEach(function (btn) {
      if (blocked) {
        btn.disabled = true;
        if (!btn.getAttribute("data-original-label")) {
          btn.setAttribute("data-original-label", btn.textContent || "");
        }
        btn.textContent = "Customer Only";
        return;
      }
      btn.addEventListener("click", function () {
        addToCart({
          name: btn.getAttribute("data-name") || "Food Item",
          price: Number(btn.getAttribute("data-price") || 0),
          restaurant: btn.getAttribute("data-restaurant") || "FoodRush Kitchen",
          image: btn.getAttribute("data-image") || "",
        });
      });
    });
  }

  function renderOwnerMenuOnMenuPage() {
    var section = document.getElementById("ownerMenuSection");
    var grid = document.getElementById("ownerMenuGrid");
    if (!section || !grid) return;

    var items = getOwnerMenu();
    if (!items.length) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";
    grid.innerHTML = "";
    items.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "card menu-card";
      card.innerHTML =
        '<img src="' +
        String(item.image || "") +
        '" alt="' +
        String(item.name || "Owner item") +
        ' dish" loading="lazy" />' +
        '<div class="card-body">' +
        "<h3>" +
        String(item.name || "Item") +
        "</h3>" +
        '<p class="meta">' +
        formatMoney(item.price || 0) +
        " | " +
        String(item.category || "Special") +
        "</p>" +
        '<p class="meta">' +
        String(item.description || "Freshly prepared owner special.") +
        "</p>" +
        '<button class="btn primary" type="button" data-add-item data-name="' +
        String(item.name || "Item") +
        '" data-price="' +
        Number(item.price || 0) +
        '" data-restaurant="' +
        String(item.restaurant || "Owner Kitchen") +
        '" data-image="' +
        String(item.image || "") +
        '">Add +</button>' +
        "</div>";
      grid.appendChild(card);
    });
  }

  function renderCartPage() {
    var body = document.getElementById("cartItemsBody");
    if (!body) return;

    var cart = getCart();
    var notes = localStorage.getItem(storageKeys.notes) || "";
    var notesInput = document.getElementById("cartNotes");
    if (notesInput) notesInput.value = notes;
    if (notesInput) {
      notesInput.addEventListener("input", function () {
        localStorage.setItem(storageKeys.notes, notesInput.value || "");
      });
    }

    body.innerHTML = "";
    if (!cart.length) {
      var emptyRow = document.createElement("tr");
      emptyRow.innerHTML = '<td colspan="4" class="meta">Your cart is empty. Add items from menu.</td>';
      body.appendChild(emptyRow);
    } else {
      cart.forEach(function (item) {
        var row = document.createElement("tr");
        row.innerHTML =
          "<td>" +
          item.name +
          "<br/><span class='meta'>" +
          item.restaurant +
          "</span></td>" +
          "<td>" +
          formatMoney(item.price) +
          "</td>" +
          "<td><button class='btn ghost cart-qty' data-key='" +
          item.key +
          "' data-op='dec' type='button'>-</button> " +
          Number(item.qty || 1) +
          " <button class='btn ghost cart-qty' data-key='" +
          item.key +
          "' data-op='inc' type='button'>+</button></td>" +
          "<td><button class='btn ghost cart-remove' data-key='" +
          item.key +
          "' type='button'>Remove</button></td>";
        body.appendChild(row);
      });
    }

    var stats = cartStats();
    var itemsTotal = document.getElementById("cartItemsTotal");
    var deliveryFee = document.getElementById("cartDeliveryFee");
    var grandTotal = document.getElementById("cartGrandTotal");
    if (itemsTotal) itemsTotal.textContent = formatMoney(stats.itemsTotal);
    if (deliveryFee) deliveryFee.textContent = formatMoney(stats.deliveryFee);
    if (grandTotal) grandTotal.textContent = formatMoney(stats.grandTotal);

    var checkoutBtn = document.getElementById("goCheckoutBtn");
    if (checkoutBtn) checkoutBtn.style.pointerEvents = cart.length ? "auto" : "none";
    if (checkoutBtn) checkoutBtn.style.opacity = cart.length ? "1" : "0.6";

    body.querySelectorAll(".cart-qty").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-key");
        var op = btn.getAttribute("data-op");
        var next = getCart()
          .map(function (item) {
            if (item.key !== key) return item;
            var qty = Number(item.qty || 1) + (op === "inc" ? 1 : -1);
            return Object.assign({}, item, { qty: Math.max(qty, 0) });
          })
          .filter(function (item) {
            return Number(item.qty || 0) > 0;
          });
        saveCart(next);
        syncCartBadges();
        renderCartPage();
      });
    });

    body.querySelectorAll(".cart-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-key");
        var next = getCart().filter(function (item) {
          return item.key !== key;
        });
        saveCart(next);
        syncCartBadges();
        renderCartPage();
      });
    });
  }

  function renderCheckoutPage() {
    var target = document.getElementById("checkoutItems");
    if (!target) return;
    var cart = getCart();
    var stats = cartStats();

    target.innerHTML = "";
    if (!cart.length) {
      target.innerHTML = '<p class="meta">No items in cart. Please add dishes first.</p>';
    } else {
      cart.forEach(function (item) {
        var p = document.createElement("p");
        p.className = "meta";
        p.textContent = item.name + " x" + item.qty + " - " + formatMoney(item.price * item.qty);
        target.appendChild(p);
      });
    }

    var itemsTotal = document.getElementById("checkoutItemsTotal");
    var deliveryFee = document.getElementById("checkoutDeliveryFee");
    var grandTotal = document.getElementById("checkoutGrandTotal");
    if (itemsTotal) itemsTotal.textContent = formatMoney(stats.itemsTotal);
    if (deliveryFee) deliveryFee.textContent = formatMoney(stats.deliveryFee);
    if (grandTotal) grandTotal.textContent = formatMoney(stats.grandTotal);

    var placeOrderBtn = document.getElementById("placeOrderBtn");
    if (!placeOrderBtn) return;
    placeOrderBtn.disabled = !cart.length;
    placeOrderBtn.addEventListener("click", function (event) {
      event.preventDefault();
      if (!cart.length) return;

      var methodNode = document.querySelector("input[name='payment']:checked");
      var paymentMethod = methodNode ? methodNode.value : "UPI";
      var order = {
        id: "FD-" + String(Date.now()).slice(-6),
        createdAt: new Date().toISOString(),
        partner: "Arjun",
        partnerVehicle: "Bike AP09XZ1234",
        etaMinutes: 25,
        address: "Road No. 12, Banjara Hills, Hyderabad",
        paymentMethod: paymentMethod,
        statusIndex: 0,
        statuses: [
          "Order Confirmed",
          "Restaurant Preparing",
          "Picked Up by Delivery Partner",
          "On the Way",
          "Delivered",
        ],
        notes: localStorage.getItem(storageKeys.notes) || "",
        items: cart,
        itemsTotal: stats.itemsTotal,
        deliveryFee: stats.deliveryFee,
        grandTotal: stats.grandTotal,
      };

      var orders = getOrders();
      orders.unshift(order);
      saveOrders(orders);
      saveCart([]);
      localStorage.removeItem(storageKeys.notes);
      syncCartBadges();
      toast("Order placed successfully");
      setTimeout(function () {
        location.href = "order-tracking.html?order=" + encodeURIComponent(order.id);
      }, 450);
    });
  }

  function findOrderById(orderId) {
    return getOrders().find(function (entry) {
      return entry.id === orderId;
    });
  }

  function updateOrder(order) {
    var orders = getOrders().map(function (entry) {
      return entry.id === order.id ? order : entry;
    });
    saveOrders(orders);
  }

  function createFallbackOrder() {
    var fallback = {
      id: "FD-" + String(Date.now()).slice(-6),
      createdAt: new Date().toISOString(),
      partner: "Arjun",
      partnerVehicle: "Bike AP09XZ1234",
      etaMinutes: 18,
      address: "Road No. 12, Banjara Hills, Hyderabad",
      paymentMethod: "UPI",
      statusIndex: 1,
      statuses: [
        "Order Confirmed",
        "Restaurant Preparing",
        "Picked Up by Delivery Partner",
        "On the Way",
        "Delivered",
      ],
      notes: "",
      items: [{ name: "Chicken Burger", qty: 1, price: 150, restaurant: "Burger Hub" }],
      itemsTotal: 150,
      deliveryFee: 30,
      grandTotal: 180,
    };
    var orders = getOrders();
    orders.unshift(fallback);
    saveOrders(orders);
    return fallback;
  }

  function renderOrderTracking() {
    var meta = document.getElementById("trackingMeta");
    var statuses = document.getElementById("trackingTimeline");
    var addressLine = document.getElementById("trackingAddress");
    var paymentLine = document.getElementById("trackingPayment");
    var noteLine = document.getElementById("trackingNote");
    if (!meta || !statuses) return;

    var params = new URLSearchParams(location.search || "");
    var orderId = params.get("order");
    var order = orderId ? findOrderById(orderId) : getOrders()[0];
    if (!order) order = createFallbackOrder();

    var controls = document.getElementById("trackingControls");
    var role = getRole();
    var canUpdate = role === "delivery_partner" || role === "admin";

    function draw(currentOrder) {
      meta.textContent =
        "Order #" +
        currentOrder.id +
        " | ETA " +
        String(currentOrder.etaMinutes || 18) +
        " mins | Partner: " +
        String(currentOrder.partner || "Delivery Partner") +
        " (" +
        String(currentOrder.partnerVehicle || "Bike") +
        ")";
      if (addressLine) {
        addressLine.textContent = "Delivery Address: " + String(currentOrder.address || "-");
      }
      if (paymentLine) {
        paymentLine.textContent = "Payment Method: " + String(currentOrder.paymentMethod || "UPI");
      }
      if (noteLine) {
        noteLine.textContent = "Delivery Note: " + String(currentOrder.notes || "No special instructions");
      }
      statuses.innerHTML = "";
      currentOrder.statuses.forEach(function (status, index) {
        var li = document.createElement("li");
        li.textContent = status;
        if (index <= Number(currentOrder.statusIndex || 0)) li.classList.add("active");
        statuses.appendChild(li);
      });
    }

    draw(order);

    if (controls) {
      controls.style.display = canUpdate ? "flex" : "none";
      if (canUpdate && !controls.dataset.bound) {
        controls.dataset.bound = "1";
        controls.addEventListener("click", function (event) {
          var btn = event.target.closest("[data-status-step]");
          if (!btn) return;
          var latest = findOrderById(order.id);
          if (!latest) return;
          var nextIndex = Number(btn.getAttribute("data-status-step") || latest.statusIndex || 0);
          if (!Number.isFinite(nextIndex)) return;
          nextIndex = Math.max(0, Math.min(nextIndex, latest.statuses.length - 1));
          latest.statusIndex = nextIndex;
          latest.etaMinutes = Math.max(5, 25 - nextIndex * 5);
          updateOrder(latest);
          draw(latest);
          toast("Tracking updated");
        });
      }
    }
  }

  function renderProfile() {
    var list = document.getElementById("ordersList");
    if (!list) return;
    var orders = getOrders();

    var totalOrdersNode = document.getElementById("kpiOrderCount");
    if (totalOrdersNode) totalOrdersNode.textContent = String(orders.length);
    var delivered = orders.filter(function (order) {
      return Number(order.statusIndex || 0) >= 4;
    }).length;
    var deliveredNode = document.getElementById("kpiDelivered");
    if (deliveredNode) deliveredNode.textContent = String(delivered);

    list.innerHTML = "";
    if (!orders.length) {
      list.innerHTML = '<p class="meta">No orders yet. Start ordering from restaurants.</p>';
      return;
    }

    orders.slice(0, 8).forEach(function (order) {
      var panel = document.createElement("article");
      panel.className = "panel";
      panel.innerHTML =
        "<h3>Order #" +
        order.id +
        "</h3>" +
        "<p class='meta'>Items: " +
        order.items.map(function (item) {
          return item.name + " x" + item.qty;
        }).join(", ") +
        "</p>" +
        "<p class='meta'>Total: " +
        formatMoney(order.grandTotal) +
        " | Payment: " +
        String(order.paymentMethod || "UPI") +
        "</p>" +
        "<p class='meta'>Status: " +
        order.statuses[order.statusIndex || 0] +
        "</p>" +
        "<a class='btn ghost' href='order-tracking.html?order=" +
        encodeURIComponent(order.id) +
        "'>Track Order</a>";
      list.appendChild(panel);
    });
  }

  function renderOwnerDashboard() {
    var form = document.getElementById("ownerMenuForm");
    var list = document.getElementById("ownerMenuList");
    if (!form || !list) return;

    var role = getRole();
    var canManage = role === "restaurant_owner" || role === "admin";
    var roleNote = document.getElementById("ownerRoleNote");
    if (roleNote && !canManage) roleNote.textContent = "Only restaurant owner or admin can manage menu items.";

    Array.prototype.slice.call(form.elements).forEach(function (element) {
      if (!canManage) element.disabled = true;
    });

    function draw() {
      var items = getOwnerMenu();
      var countNode = document.getElementById("ownerMenuCount");
      var avgNode = document.getElementById("ownerAvgPrice");
      var pubNode = document.getElementById("ownerPublishedToday");
      var updatedNode = document.getElementById("ownerLastUpdated");

      if (countNode) countNode.textContent = String(items.length);
      if (avgNode) {
        var avg = items.length
          ? items.reduce(function (sum, item) {
              return sum + Number(item.price || 0);
            }, 0) / items.length
          : 0;
        avgNode.textContent = formatMoney(avg);
      }
      if (pubNode) pubNode.textContent = String(items.length);
      if (updatedNode) {
        updatedNode.textContent = items.length
          ? new Date(items[0].createdAt).toLocaleDateString()
          : "-";
      }

      list.innerHTML = "";
      if (!items.length) {
        list.innerHTML = '<p class="meta">No menu items yet. Add your first item above.</p>';
        return;
      }
      items.forEach(function (item) {
        var card = document.createElement("article");
        card.className = "panel";
        card.innerHTML =
          '<div class="action-row" style="justify-content:space-between;align-items:flex-start;">' +
          "<div>" +
          "<h3>" +
          String(item.name || "Item") +
          "</h3>" +
          '<p class="meta">' +
          formatMoney(item.price || 0) +
          " | " +
          String(item.category || "Special") +
          "</p>" +
          '<p class="meta">' +
          String(item.description || "") +
          "</p>" +
          "</div>" +
          '<img src="' +
          String(item.image || "") +
          '" alt="' +
          String(item.name || "Item") +
          ' image" style="width:140px;height:92px;object-fit:cover;border-radius:10px;border:1px solid #f0f0f0;" />' +
          "</div>" +
          (canManage
            ? '<div class="action-row" style="margin-top:10px;"><button class="btn ghost owner-remove" type="button" data-id="' +
              String(item.id) +
              '">Delete</button></div>'
            : "");
        list.appendChild(card);
      });
    }

    if (canManage && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = Object.fromEntries(new FormData(form).entries());
        var name = String(data.name || "").trim();
        var price = Number(data.price || 0);
        var image = String(data.image || "").trim();
        if (!name || !price || !image) {
          toast("Name, price, and image URL are required");
          return;
        }
        var user = getUser();
        var next = getOwnerMenu();
        next.unshift({
          id: "item-" + Date.now(),
          name: name,
          price: price,
          category: String(data.category || "Special"),
          image: image,
          description: String(data.description || "").trim(),
          restaurant: String(user.name || "Owner Kitchen"),
          createdAt: new Date().toISOString(),
        });
        saveOwnerMenu(next);
        form.reset();
        draw();
        toast("Menu item added");
      });
    }

    if (canManage && !list.dataset.bound) {
      list.dataset.bound = "1";
      list.addEventListener("click", function (event) {
        var btn = event.target.closest(".owner-remove");
        if (!btn) return;
        var id = btn.getAttribute("data-id");
        var next = getOwnerMenu().filter(function (item) {
          return String(item.id) !== String(id);
        });
        saveOwnerMenu(next);
        draw();
        toast("Menu item removed");
      });
    }

    draw();
  }

  function renderDeliveryDashboard() {
    var list = document.getElementById("deliveryOrdersList");
    if (!list) return;

    var role = getRole();
    var canUpdate = role === "delivery_partner" || role === "admin";
    var orders = getOrders();

    var assignedNode = document.getElementById("deliveryAssignedCount");
    var inTransitNode = document.getElementById("deliveryInTransitCount");
    var deliveredNode = document.getElementById("deliveryDeliveredCount");
    var etaNode = document.getElementById("deliveryAvgEta");
    if (assignedNode) assignedNode.textContent = String(orders.length);
    if (inTransitNode) {
      inTransitNode.textContent = String(
        orders.filter(function (order) {
          return Number(order.statusIndex || 0) === 2 || Number(order.statusIndex || 0) === 3;
        }).length
      );
    }
    if (deliveredNode) {
      deliveredNode.textContent = String(
        orders.filter(function (order) {
          return Number(order.statusIndex || 0) >= 4;
        }).length
      );
    }
    if (etaNode) {
      var avg = orders.length
        ? orders.reduce(function (sum, order) {
            return sum + Number(order.etaMinutes || 0);
          }, 0) / orders.length
        : 0;
      etaNode.textContent = Math.round(avg) + " min";
    }

    list.innerHTML = "";
    if (!orders.length) {
      list.innerHTML = '<p class="meta">No assigned orders available right now.</p>';
      return;
    }

    orders.forEach(function (order) {
      var card = document.createElement("article");
      var safeOrderKey = slugify(order.id || ("order-" + Date.now()));
      card.className = "panel";
      card.setAttribute("data-order-id", String(order.id || ""));

      var status = order.statuses[order.statusIndex || 0];
      card.innerHTML =
        "<h3>Order #" +
        String(order.id) +
        "</h3>" +
        '<p class="meta">Items: ' +
        order.items.map(function (item) {
          return item.name + " x" + item.qty;
        }).join(", ") +
        "</p>" +
        '<p class="meta">Current Status: <span class="status-badge">' +
        String(status || "-") +
        "</span></p>" +
        '<div class="form-grid" style="margin-top:10px;">' +
        '<div><label>Partner Name</label><input type="text" data-delivery-field="partner" id="partner-' +
        safeOrderKey +
        '" value="' +
        String(order.partner || "") +
        '" ' +
        (canUpdate ? "" : "disabled") +
        " /></div>" +
        '<div><label>Vehicle</label><input type="text" data-delivery-field="vehicle" id="vehicle-' +
        safeOrderKey +
        '" value="' +
        String(order.partnerVehicle || "") +
        '" ' +
        (canUpdate ? "" : "disabled") +
        " /></div>" +
        '<div><label>ETA (min)</label><input type="number" min="0" data-delivery-field="eta" id="eta-' +
        safeOrderKey +
        '" value="' +
        Number(order.etaMinutes || 0) +
        '" ' +
        (canUpdate ? "" : "disabled") +
        " /></div>" +
        '<div><label>Address</label><input type="text" data-delivery-field="address" id="address-' +
        safeOrderKey +
        '" value="' +
        String(order.address || "") +
        '" ' +
        (canUpdate ? "" : "disabled") +
        " /></div>" +
        '<div class="full"><label>Delivery Notes</label><textarea rows="2" data-delivery-field="notes" id="notes-' +
        safeOrderKey +
        '" ' +
        (canUpdate ? "" : "disabled") +
        ">" +
        String(order.notes || "") +
        "</textarea></div>" +
        "</div>" +
        '<div class="action-row" style="margin-top:10px;">' +
        (canUpdate
          ? '<button class="btn ghost delivery-save" type="button" data-id="' +
            String(order.id) +
            '">Save Details</button>'
          : "") +
        (canUpdate && Number(order.statusIndex || 0) < 4
          ? '<button class="btn ghost delivery-next" type="button" data-id="' +
            String(order.id) +
            '">Next Status</button>'
          : "") +
        (canUpdate
          ? '<button class="btn primary delivery-done" type="button" data-id="' +
            String(order.id) +
            '">Mark Delivered</button>'
          : "") +
        '<a class="btn ghost" href="order-tracking.html?order=' +
        encodeURIComponent(order.id) +
        '">Open Tracking</a>' +
        "</div>";
      list.appendChild(card);
    });

    if (canUpdate && !list.dataset.bound) {
      list.dataset.bound = "1";
      list.addEventListener("click", function (event) {
        var saveBtn = event.target.closest(".delivery-save");
        var nextBtn = event.target.closest(".delivery-next");
        var doneBtn = event.target.closest(".delivery-done");
        var targetId = "";
        if (saveBtn) targetId = String(saveBtn.getAttribute("data-id") || "");
        if (nextBtn) targetId = String(nextBtn.getAttribute("data-id") || "");
        if (doneBtn) targetId = String(doneBtn.getAttribute("data-id") || "");
        if (!targetId) return;
        var current = findOrderById(targetId);
        if (!current) return;

        if (saveBtn) {
          var card = saveBtn.closest("[data-order-id]");
          if (!card) return;
          var partnerInput = card.querySelector('[data-delivery-field="partner"]');
          var vehicleInput = card.querySelector('[data-delivery-field="vehicle"]');
          var etaInput = card.querySelector('[data-delivery-field="eta"]');
          var addressInput = card.querySelector('[data-delivery-field="address"]');
          var notesInput = card.querySelector('[data-delivery-field="notes"]');

          current.partner = String(partnerInput ? partnerInput.value : current.partner || "").trim() || "Delivery Partner";
          current.partnerVehicle = String(vehicleInput ? vehicleInput.value : current.partnerVehicle || "").trim() || "Bike";
          current.etaMinutes = Math.max(0, Number(etaInput ? etaInput.value : current.etaMinutes || 0));
          current.address = String(addressInput ? addressInput.value : current.address || "").trim() || current.address;
          current.notes = String(notesInput ? notesInput.value : current.notes || "").trim();
          updateOrder(current);
          toast("Delivery details updated");
          renderDeliveryDashboard();
          return;
        }

        if (doneBtn) {
          current.statusIndex = 4;
          current.etaMinutes = 0;
        } else if (Number(current.statusIndex || 0) < current.statuses.length - 1) {
          current.statusIndex += 1;
          current.etaMinutes = Math.max(5, Number(current.etaMinutes || 25) - 5);
        }
        updateOrder(current);
        toast("Order status updated");
        renderDeliveryDashboard();
      });
    }
  }

  function init() {
    if (!protectPages()) return;
    ensureTopNav();
    renderOwnerMenuOnMenuPage();
    bindAddToCartButtons();
    renderCartPage();
    renderCheckoutPage();
    renderOrderTracking();
    renderProfile();
    renderOwnerDashboard();
    renderDeliveryDashboard();
    syncCartBadges();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
