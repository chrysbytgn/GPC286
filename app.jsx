import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, collection, onSnapshot, addDoc, updateDoc, deleteDoc, query, where, getDocs } from 'firebase/firestore';
import { Plus, Send, X, Edit, Trash2, CheckCircle, ChevronLeft, ChevronRight, Upload, FileText, Check, Archive, ArchiveRestore } from 'lucide-react';

// Define global variables for Firebase configuration.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Order colors.
const ORDER_COLORS = {
  instalacion: 'bg-blue-500',
  posdatado: 'bg-yellow-400',
  completo: 'bg-green-500',
  parcial: 'bg-lime-400',
  recogida: 'bg-red-500',
};

// Color priority for calendar days (higher number = higher priority).
const COLOR_PRIORITY = {
  recogida: 5,
  posdatado: 4,
  instalacion: 3,
  completo: 2,
  parcial: 1,
};

// Reusable modal component.
const CustomModal = ({ title, children, onClose, fullWidth = false }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
    <div className={`relative w-full rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800 ${fullWidth ? 'max-w-4xl' : 'max-w-lg'}`}>
      <div className="flex items-center justify-between border-b pb-3">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
          <X size={24} />
        </button>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  </div>
);

const App = () => {
  // Application state.
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [orders, setOrders] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [archivedOrders, setArchivedOrders] = useState([]);
  
  // State for view navigation.
  const [view, setView] = useState('calendar');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedDayOrders, setSelectedDayOrders] = useState([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [importOrderType, setImportOrderType] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailContent, setEmailContent] = useState('');
  const [message, setMessage] = useState(null);

  // State for bulk delete confirmation modal.
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);

  // State for import preview.
  const [importPreview, setImportPreview] = useState([]);
  const [isImportPreviewModalOpen, setIsImportPreviewModalOpen] = useState(false);

  // Estado para controlar la vista de pedidos archivados.
  const [showArchived, setShowArchived] = useState(false);

  // Initialize Firebase.
  useEffect(() => {
    const initFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const authService = getAuth(app);
        setDb(firestore);
        setAuth(authService);

        if (initialAuthToken) {
          await signInWithCustomToken(authService, initialAuthToken);
        } else {
          await signInAnonymously(authService);
        }

        onAuthStateChanged(authService, (user) => {
          if (user) {
            setUserId(user.uid);
          }
          setIsAuthReady(true);
          setLoading(false);
        });

      } catch (error) {
        console.error("Error initializing Firebase:", error);
        setMessage({ type: 'error', text: 'Error al conectar con la base de datos.' });
        setLoading(false);
      }
    };

    initFirebase();
  }, []);

  // Listen for changes in the orders collection and separate into pending, confirmed, and archived orders.
  useEffect(() => {
    if (db && userId && isAuthReady) {
      const ordersCollectionRef = collection(db, `artifacts/${appId}/public/data/orders`);
      const q = query(ordersCollectionRef);

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Get the start of the current day for correct comparison (ignoring time).
        const todayStart = new Date().setHours(0, 0, 0, 0);

        // Filter orders into three groups.
        const confirmed = ordersData.filter(order =>
          order.deliveryDate && new Date(order.deliveryDate).setHours(0, 0, 0, 0) >= todayStart
        );
        
        const pending = ordersData.filter(order =>
          (!order.deliveryDate || new Date(order.deliveryDate).setHours(0, 0, 0, 0) < todayStart) && !order.archived
        );

        const archived = ordersData.filter(order => order.archived);

        setOrders(confirmed);
        setPendingOrders(pending);
        setArchivedOrders(archived);
      }, (error) => {
        console.error("Error getting orders:", error);
        setMessage({ type: 'error', text: 'Error al obtener los datos de pedidos.' });
      });

      return () => unsubscribe();
    }
  }, [db, userId, isAuthReady]);

  const openOrderModal = useCallback((order = null) => {
    setCurrentOrder(order);
    setIsModalOpen(true);
  }, []);

  const closeModals = useCallback(() => {
    setIsModalOpen(false);
    setIsImportModalOpen(false);
    setIsEmailModalOpen(false);
    setIsDeleteAllModalOpen(false);
    setIsImportPreviewModalOpen(false);
    setCurrentOrder(null);
    setPastedText('');
    setImportOrderType('');
    setUploadedFile(null);
    setImportPreview([]);
  }, []);

  const handleSaveOrder = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const orderNumber = form.get('orderNumber');
    const customerName = form.get('customerName');
    const type = form.get('type');
    const deliveryDate = form.get('deliveryDate');

    const orderData = {
      orderNumber,
      customerName,
      type: type,
      color: ORDER_COLORS[type] || 'bg-gray-300',
      deliveryDate: deliveryDate ? new Date(deliveryDate).toISOString() : null,
      archived: false,
    };

    try {
      if (currentOrder) {
        await updateDoc(doc(db, `artifacts/${appId}/public/data/orders`, currentOrder.id), orderData);
        setMessage({ type: 'success', text: 'Pedido actualizado con éxito.' });
      } else {
        await addDoc(collection(db, `artifacts/${appId}/public/data/orders`), { ...orderData, createdAt: new Date().toISOString() });
        setMessage({ type: 'success', text: 'Pedido añadido con éxito.' });
      }
      closeModals();
    } catch (error) {
      console.error("Error saving order:", error);
      setMessage({ type: 'error', text: 'Error al guardar el pedido. Inténtalo de nuevo.' });
    }
  };

  const handleDeleteOrder = async (id) => {
    try {
      await deleteDoc(doc(db, `artifacts/${appId}/public/data/orders`, id));
      setMessage({ type: 'success', text: 'Pedido eliminado con éxito.' });
    } catch (error) {
      console.error("Error deleting order:", error);
      setMessage({ type: 'error', text: 'Error al eliminar el pedido.' });
    }
  };

  const handleDeleteAllOrders = async () => {
    if (!db) return;
    try {
      const ordersCollectionRef = collection(db, `artifacts/${appId}/public/data/orders`);
      const snapshot = await getDocs(ordersCollectionRef);
      const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, `artifacts/${appId}/public/data/orders`, d.id)));
      await Promise.all(deletePromises);
      setMessage({ type: 'success', text: 'Todos los pedidos han sido eliminados correctamente.' });
      closeModals();
    } catch (error) {
      console.error("Error deleting all orders:", error);
      setMessage({ type: 'error', text: 'Error al eliminar todos los pedidos. Inténtalo de nuevo.' });
      closeModals();
    }
  };

  const handleConfirmDelivery = async (order) => {
    try {
      await updateDoc(doc(db, `artifacts/${appId}/public/data/orders`, order.id), {
        deliveryDate: new Date().toISOString(),
      });
      setMessage({ type: 'success', text: `Pedido ${order.orderNumber} confirmado para hoy.` });
    } catch (error) {
      console.error("Error confirming delivery:", error);
      setMessage({ type: 'error', text: 'Error al confirmar la entrega.' });
    }
  };

  // Nueva función para archivar un pedido
  const handleArchiveOrder = async (id) => {
    try {
      await updateDoc(doc(db, `artifacts/${appId}/public/data/orders`, id), {
        archived: true,
      });
      setMessage({ type: 'success', text: 'Pedido archivado con éxito.' });
    } catch (error) {
      console.error("Error archiving order:", error);
      setMessage({ type: 'error', text: 'Error al archivar el pedido.' });
    }
  };

  // Nueva función para desarchivar un pedido
  const handleRestoreOrder = async (id) => {
    try {
      await updateDoc(doc(db, `artifacts/${appId}/public/data/orders`, id), {
        archived: false,
      });
      setMessage({ type: 'success', text: 'Pedido restaurado con éxito.' });
    } catch (error) {
      console.error("Error restoring order:", error);
      setMessage({ type: 'error', text: 'Error al restaurar el pedido.' });
    }
  };

  const handleGenerateEmail = useCallback(() => {
    const dailyOrders = orders.filter(o => new Date(o.deliveryDate).toDateString() === selectedDate.toDateString());
    let emailHtml = `<p><strong>Resumen de Entregas para el ${selectedDate.toLocaleDateString()}:</strong></p><ul>`;

    dailyOrders.forEach(order => {
      let colorStyle = '';
      switch(order.type) {
        case 'instalacion': colorStyle = 'style="color: #3B82F6;"'; break;
        case 'posdatado': colorStyle = 'style="color: #FACC15;"'; break;
        case 'completo': colorStyle = 'style="color: #22C55E;"'; break;
        case 'parcial': colorStyle = 'style="color: #A3E635;"'; break;
        case 'recogida': colorStyle = 'style="color: #EF4444;"'; break;
        default: colorStyle = 'style="color: #9CA3AF;"'; break;
      }
      emailHtml += `<li><span ${colorStyle}>●</span> Pedido #${order.orderNumber} - Cliente: ${order.customerName} (${order.type})</li>`;
    });

    emailHtml += `</ul>`;
    setEmailContent(emailHtml);
    setIsEmailModalOpen(true);
  }, [orders, selectedDate]);
  
  const handleTypeChange = (e) => {
    setImportOrderType(e.target.value);
    setPastedText('');
    setUploadedFile(null);
  };
  
  const handleFileChange = (e) => {
    setUploadedFile(e.target.files[0]);
    setPastedText('');
  };
  
  const handlePreviewImport = async () => {
    if (!importOrderType) {
        setMessage({ type: 'error', text: 'Por favor, selecciona un tipo de pedido.' });
        return;
    }

    const hasData = (uploadedFile) || (pastedText.trim().length > 0);
    
    if (!hasData) {
      setMessage({ type: 'error', text: 'Por favor, sube un archivo o pega el texto de los pedidos.' });
      return;
    }

    setIsImporting(true);
    setMessage(null);

    let textContent = pastedText;
    if (uploadedFile) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            textContent = e.target.result;
            await processImport(textContent, uploadedFile.name);
        };
        reader.onerror = (e) => {
            console.error("Error reading file:", e);
            setMessage({ type: 'error', text: 'Error al leer el archivo. Asegúrate de que es un archivo de texto válido.' });
            setIsImporting(false);
        };
        reader.readAsText(uploadedFile);
    } else {
        await processImport(textContent);
    }
  };

  const processImport = async (text, fileName = null) => {
    try {
      const lines = text.trim().split('\n');
      const parsedOrders = [];
      const existingOrders = [...orders, ...pendingOrders, ...archivedOrders];

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        if (trimmedLine.toLowerCase().includes('fecha entrega')) {
            console.log(`Línea de encabezado detectada y omitida: "${trimmedLine}"`);
            continue;
        }

        const commaParts = trimmedLine.split(',');
        let parts, orderNumber, customerName, deliveryDateStr;
        
        if (commaParts.length >= 3) {
          parts = commaParts;
          orderNumber = parts[0].trim();
          deliveryDateStr = parts[parts.length - 1].trim();
          customerName = parts.slice(1, parts.length - 1).join(',').trim();
        } else {
          parts = trimmedLine.split(/\s+/);
          if (parts.length < 3) {
            console.warn(`Línea ignorada por formato incorrecto (espacios): "${trimmedLine}"`);
            continue;
          }
          orderNumber = parts[0];
          deliveryDateStr = parts[parts.length - 1];
          customerName = parts.slice(1, parts.length - 1).join(' ');
        }
        
        if (!orderNumber || !customerName || !deliveryDateStr) {
          console.warn(`Línea ignorada por datos incompletos: "${trimmedLine}"`);
          continue;
        }

        let deliveryDate = null;
        const dateParts = deliveryDateStr.split('/');
        
        if (dateParts.length === 3) {
            const day = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10) - 1;
            const year = parseInt(dateParts[2], 10);
            
            const tempDate = new Date(year, month, day);
            if (tempDate.getFullYear() === year && tempDate.getMonth() === month && !isNaN(tempDate.getTime())) {
                deliveryDate = tempDate;
            }
        } else {
            const match = deliveryDateStr.match(/^(\d{1,2})\/(\d{1,2})(\d{4})$/);
            if (match && match.length === 4) {
                const day = parseInt(match[1], 10);
                const month = parseInt(match[2], 10) - 1;
                const year = parseInt(match[3], 10);
                const tempDate = new Date(year, month, day);
                if (tempDate.getFullYear() === year && tempDate.getMonth() === month && !isNaN(tempDate.getTime())) {
                    deliveryDate = tempDate;
                }
            }
        }
        
        if (!deliveryDate) {
            console.error(`Fecha inválida detectada y omitida: "${deliveryDateStr}" en la línea "${trimmedLine}"`);
            continue;
        }

        const newOrderData = {
          orderNumber: orderNumber.replace(/€/g, '').trim(),
          customerName: customerName.trim(),
          type: importOrderType,
          color: ORDER_COLORS[importOrderType],
          deliveryDate: deliveryDate.toISOString(),
          file: fileName,
        };
        
        const existingOrder = existingOrders.find(o => o.orderNumber === newOrderData.orderNumber);
        
        if (existingOrder) {
          const existingPriority = COLOR_PRIORITY[existingOrder.type] || 0;
          const newPriority = COLOR_PRIORITY[newOrderData.type] || 0;
          
          if (newPriority > existingPriority) {
            parsedOrders.push({
              ...newOrderData,
              id: existingOrder.id,
              status: 'Actualizar'
            });
          }
        } else {
          parsedOrders.push({
            ...newOrderData,
            status: 'Nuevo'
          });
        }
      }
      
      if (parsedOrders.length > 0) {
        setImportPreview(parsedOrders);
        setIsImportPreviewModalOpen(true);
        setIsImportModalOpen(false);
      } else {
        setMessage({ type: 'warning', text: 'El contenido está vacío o no contiene datos válidos. No se ha generado ninguna vista previa.' });
      }

    } catch (error) {
      console.error("Error processing text:", error);
      setMessage({ type: 'error', text: 'Error al procesar los datos. Asegúrate de que el formato sea correcto.' });
    } finally {
      setIsImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    try {
      const ordersToAdd = importPreview.filter(o => o.status === 'Nuevo');
      const ordersToUpdate = importPreview.filter(o => o.status === 'Actualizar');
      
      const addPromises = ordersToAdd.map(order => {
        const { status, ...rest } = order;
        return addDoc(collection(db, `artifacts/${appId}/public/data/orders`), { ...rest, createdAt: new Date().toISOString() });
      });
      
      const updatePromises = ordersToUpdate.map(order => {
        const { status, id, ...rest } = order;
        return updateDoc(doc(db, `artifacts/${appId}/public/data/orders`, id), rest);
      });
      
      await Promise.all([...addPromises, ...updatePromises]);
      setMessage({ type: 'success', text: `Se han importado ${ordersToAdd.length} pedidos nuevos y se han actualizado ${ordersToUpdate.length}.` });
    } catch (error) {
      console.error("Error importing orders:", error);
      setMessage({ type: 'error', text: 'Error al importar los pedidos. Inténtalo de nuevo.' });
    } finally {
      closeModals();
    }
  };

  const handleCopyEmailContent = () => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = emailContent;
    document.body.appendChild(tempDiv);
    
    const range = document.createRange();
    range.selectNodeContents(tempDiv);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    
    try {
      document.execCommand('copy');
      setMessage({ type: 'success', text: 'Contenido del email copiado al portapapeles.' });
    } catch (err) {
      console.error('Failed to copy text: ', err);
      setMessage({ type: 'error', text: 'Error al copiar el contenido.' });
    }
    
    document.body.removeChild(tempDiv);
    closeModals();
  };

  const daysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  const prevMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
  const nextMonth = () => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
  const isSameDay = (d1, d2) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

  const renderCalendar = () => {
    const totalDays = daysInMonth(selectedDate);
    const firstDay = firstDayOfMonth(selectedDate);
    const blanks = Array(firstDay === 0 ? 6 : firstDay - 1).fill(null);
    const days = Array.from({ length: totalDays }, (_, i) => i + 1);

    const allDays = [...blanks, ...days];
    const today = new Date();
    const calendarOrders = orders.filter(o => {
      const deliveryDate = new Date(o.deliveryDate);
      return deliveryDate.getFullYear() === selectedDate.getFullYear() && deliveryDate.getMonth() === selectedDate.getMonth();
    });

    return (
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="flex items-center justify-between p-2 mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
          <button onClick={prevMonth} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition">
            <ChevronLeft size={24} className="text-gray-700 dark:text-gray-300" />
          </button>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
            {selectedDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={nextMonth} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition">
            <ChevronRight size={24} className="text-gray-700 dark:text-gray-300" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
            <div key={day} className="text-center font-bold text-gray-500 dark:text-gray-400">
              {day}
            </div>
          ))}
          {allDays.map((day, index) => {
            const date = day ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day) : null;
            const dailyOrders = date ? calendarOrders.filter(o => isSameDay(new Date(o.deliveryDate), date)) : [];
            const hasOrders = dailyOrders.length > 0;
            const isToday = day && isSameDay(date, today);

            // Determine the color for the day based on order priority.
            const dayColor = dailyOrders.reduce((color, order) => {
              const orderPriority = COLOR_PRIORITY[order.type];
              if (orderPriority > (COLOR_PRIORITY[color] || 0)) {
                return order.type;
              }
              return color;
            }, '');
            const dayColorClass = dayColor ? ORDER_COLORS[dayColor] : 'bg-gray-200 dark:bg-gray-600';

            return (
              <div
                key={index}
                className={`
                  p-2 aspect-square rounded-lg flex flex-col justify-between cursor-pointer
                  ${day ? 'hover:scale-105 transform transition duration-150' : ''}
                  ${day && !hasOrders ? 'bg-gray-100 dark:bg-gray-700' : ''}
                  ${isToday ? 'border-2 border-blue-500 dark:border-blue-400' : ''}
                `}
                onClick={() => {
                  if (day) {
                    setSelectedDate(date);
                    setSelectedDayOrders(dailyOrders);
                    setView('dayOrders');
                  }
                }}
              >
                <div className={`text-right font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-100'}`}>
                  {day}
                </div>
                {hasOrders && (
                  <div className={`
                    w-full h-2 rounded-full
                    ${dayColorClass}
                  `}></div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  
  const renderOrderList = (list, isPending = false) => {
    if (list.length === 0) {
      return (
        <div className="text-center text-gray-500 dark:text-gray-400 p-8">
          No hay pedidos {isPending ? 'pendientes' : 'archivados'}.
        </div>
      );
    }
    
    return (
      <ul className="space-y-4">
        {list.map(order => (
          <li key={order.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4 flex flex-col md:flex-row items-start md:items-center justify-between transition-transform duration-200 hover:scale-[1.01]">
            <div className="flex-1 mb-2 md:mb-0">
              <p className="text-lg font-bold text-gray-900 dark:text-white">Pedido #{order.orderNumber}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Cliente: {order.customerName}</p>
              <span className={`inline-block px-2 py-1 mt-1 text-xs font-semibold text-white rounded-full ${order.color}`}>
                {order.type}
              </span>
              {order.deliveryDate && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Fecha: {new Date(order.deliveryDate).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="flex space-x-2">
              <button onClick={() => openOrderModal(order)} className="p-2 rounded-full text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900 transition">
                <Edit size={20} />
              </button>
              {isPending && (
                <button onClick={() => handleConfirmDelivery(order)} className="p-2 rounded-full text-green-500 hover:bg-green-100 dark:hover:bg-green-900 transition">
                  <Check size={20} />
                </button>
              )}
              {isPending && (
                <button onClick={() => handleArchiveOrder(order.id)} className="p-2 rounded-full text-yellow-500 hover:bg-yellow-100 dark:hover:bg-yellow-900 transition">
                  <Archive size={20} />
                </button>
              )}
              {!isPending && (
                <button onClick={() => handleRestoreOrder(order.id)} className="p-2 rounded-full text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900 transition">
                  <ArchiveRestore size={20} />
                </button>
              )}
              <button onClick={() => handleDeleteOrder(order.id)} className="p-2 rounded-full text-red-500 hover:bg-red-100 dark:hover:bg-red-900 transition">
                <Trash2 size={20} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };
  
  const renderImportPreview = () => (
    <CustomModal title="Vista Previa de Importación" onClose={closeModals} fullWidth>
      <div className="max-h-96 overflow-y-auto">
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Se han detectado {importPreview.length} pedidos. Revisa y confirma la importación.
        </p>
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Estado
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Nº de Pedido
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Cliente
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Fecha
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Tipo
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700">
            {importPreview.map((order, index) => (
              <tr key={index}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${order.status === 'Nuevo' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'}`}>
                    {order.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{order.orderNumber}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{order.customerName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{new Date(order.deliveryDate).toLocaleDateString()}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${order.color}`}>
                    {order.type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex justify-end space-x-3">
        <button onClick={closeModals} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition">
          Cancelar
        </button>
        <button onClick={handleConfirmImport} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition">
          Confirmar Importación
        </button>
      </div>
    </CustomModal>
  );

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
      {/* Sidebar de Vistas y Pedidos Pendientes */}
      <aside className="w-full md:w-80 bg-white dark:bg-gray-800 p-4 md:p-6 shadow-xl md:shadow-none flex flex-col space-y-4 md:space-y-6 flex-shrink-0 border-b md:border-r border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center mb-2">
          <h1 className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">
            Pedidos
          </h1>
          <span className="text-gray-500 dark:text-gray-400 text-xs">
            ID: {userId || 'Cargando...'}
          </span>
        </div>

        <nav className="flex space-x-2 md:flex-col md:space-x-0 md:space-y-2">
          <button
            onClick={() => setView('calendar')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors duration-200
              ${view === 'calendar' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <CheckCircle size={20} />
            <span>Calendario</span>
          </button>
          <button
            onClick={() => { setView('pending'); setShowArchived(false); }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors duration-200
              ${view === 'pending' && !showArchived ? 'bg-blue-600 text-white shadow-md' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <FileText size={20} />
            <span>Pedidos Pendientes ({pendingOrders.length})</span>
          </button>
          <button
            onClick={() => { setView('pending'); setShowArchived(true); }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors duration-200
              ${view === 'pending' && showArchived ? 'bg-blue-600 text-white shadow-md' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Archive size={20} />
            <span>Pedidos Archivados ({archivedOrders.length})</span>
          </button>
        </nav>

        <div className="flex-1 mt-6">
          <button onClick={() => openOrderModal()} className="w-full bg-green-500 text-white px-4 py-2 rounded-lg shadow-md hover:bg-green-600 transition flex items-center justify-center space-x-2">
            <Plus size={20} />
            <span>Añadir Pedido</span>
          </button>
          <button onClick={() => setIsImportModalOpen(true)} className="w-full bg-indigo-500 text-white px-4 py-2 mt-2 rounded-lg shadow-md hover:bg-indigo-600 transition flex items-center justify-center space-x-2">
            <Upload size={20} />
            <span>Importar Pedidos</span>
          </button>
          <button onClick={() => setIsDeleteAllModalOpen(true)} className="w-full bg-red-500 text-white px-4 py-2 mt-2 rounded-lg shadow-md hover:bg-red-600 transition flex items-center justify-center space-x-2">
            <Trash2 size={20} />
            <span>Eliminar Todos</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-blue-500 border-dotted rounded-full animate-spin mx-auto"></div>
              <p className="mt-4 text-lg">Cargando...</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {message && (
              <div className={`p-4 mb-4 rounded-lg shadow-md flex justify-between items-center ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                <span>{message.text}</span>
                <button onClick={() => setMessage(null)} className="ml-4 text-gray-500 hover:text-gray-700">
                  <X size={20} />
                </button>
              </div>
            )}

            {view === 'calendar' && renderCalendar()}

            {view === 'pending' && (
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                <h2 className="text-3xl font-extrabold text-gray-800 dark:text-gray-100">
                  {showArchived ? 'Pedidos Archivados' : 'Pedidos Pendientes'}
                </h2>
                {renderOrderList(showArchived ? archivedOrders : pendingOrders, !showArchived)}
              </div>
            )}

            {view === 'dayOrders' && (
              <div className="flex-1 p-4 overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-3xl font-extrabold text-gray-800 dark:text-gray-100">
                    Pedidos para el {selectedDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </h2>
                  <button onClick={() => setView('calendar')} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                    Volver al Calendario
                  </button>
                  <button onClick={handleGenerateEmail} className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition flex items-center space-x-2">
                    <Send size={20} />
                    <span>Generar Email</span>
                  </button>
                </div>
                {selectedDayOrders.length > 0 ? (
                  renderOrderList(selectedDayOrders, false)
                ) : (
                  <div className="text-center text-gray-500 dark:text-gray-400 p-8">
                    No hay pedidos para este día.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal para añadir/editar pedido */}
      {isModalOpen && (
        <CustomModal title={currentOrder ? 'Editar Pedido' : 'Añadir Pedido'} onClose={closeModals}>
          <form onSubmit={handleSaveOrder} className="space-y-4">
            <div>
              <label htmlFor="orderNumber" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nº de Pedido</label>
              <input
                type="text"
                id="orderNumber"
                name="orderNumber"
                required
                defaultValue={currentOrder?.orderNumber || ''}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="customerName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre del Cliente</label>
              <input
                type="text"
                id="customerName"
                name="customerName"
                required
                defaultValue={currentOrder?.customerName || ''}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="type" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Pedido</label>
              <select
                id="type"
                name="type"
                required
                defaultValue={currentOrder?.type || 'instalacion'}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                <option value="instalacion">Instalación</option>
                <option value="posdatado">Posdatado</option>
                <option value="completo">Completo</option>
                <option value="parcial">Parcial</option>
                <option value="recogida">Recogida</option>
              </select>
            </div>
            <div>
              <label htmlFor="deliveryDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Fecha de Entrega</label>
              <input
                type="date"
                id="deliveryDate"
                name="deliveryDate"
                defaultValue={currentOrder?.deliveryDate ? currentOrder.deliveryDate.substring(0, 10) : ''}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
            <div className="flex justify-end space-x-3 mt-4">
              <button
                type="button"
                onClick={closeModals}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
              >
                {currentOrder ? 'Guardar Cambios' : 'Añadir Pedido'}
              </button>
            </div>
          </form>
        </CustomModal>
      )}

      {/* Modal para importar pedidos */}
      {isImportModalOpen && (
        <CustomModal title="Importar Pedidos" onClose={closeModals}>
          <div className="space-y-4">
            <div>
              <label htmlFor="importOrderType" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Pedido</label>
              <select
                id="importOrderType"
                name="importOrderType"
                value={importOrderType}
                onChange={handleTypeChange}
                required
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                <option value="">Selecciona un tipo...</option>
                <option value="instalacion">Instalación</option>
                <option value="posdatado">Posdatado</option>
                <option value="completo">Completo</option>
                <option value="parcial">Parcial</option>
                <option value="recogida">Recogida</option>
              </select>
            </div>
            <div className="text-center text-gray-500 dark:text-gray-400">O</div>
            <div>
              <label htmlFor="pastedText" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Pegar Texto de Pedidos</label>
              <textarea
                id="pastedText"
                rows="5"
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Ejemplo:
  Pedido123,Nombre Cliente,15/08/2025
  Pedido456,Otro Cliente,20/08/2025"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              ></textarea>
            </div>
            <div className="text-center text-gray-500 dark:text-gray-400">O</div>
            <div className="mt-4">
              <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Subir Archivo</label>
              <div className="flex items-center justify-center w-full">
                <label
                  htmlFor="file-upload"
                  className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 hover:bg-gray-100 dark:border-gray-600"
                >
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload size={24} className="mb-2 text-gray-400" />
                    <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                      <span className="font-semibold">Haz clic para subir</span> o arrastra y suelta
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Sólo archivos de texto (.txt)</p>
                  </div>
                  <input id="file-upload" type="file" className="hidden" accept=".txt" onChange={handleFileChange} />
                </label>
              </div>
              {uploadedFile && (
                <p className="text-sm text-gray-500 mt-2">Archivo seleccionado: {uploadedFile.name}</p>
              )}
            </div>
            <div className="flex justify-end space-x-3 mt-4">
              <button
                type="button"
                onClick={handlePreviewImport}
                disabled={isImporting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {isImporting ? 'Procesando...' : 'Previsualizar'}
              </button>
            </div>
          </div>
        </CustomModal>
      )}

      {/* Modal de confirmación de eliminación masiva */}
      {isDeleteAllModalOpen && (
        <CustomModal title="Confirmar Eliminación Masiva" onClose={closeModals}>
          <div className="p-4 text-center">
            <p className="text-lg text-gray-700 dark:text-gray-300">
              ¿Estás seguro de que quieres eliminar <span className="font-bold">todos</span> los pedidos? Esta acción no se puede deshacer.
            </p>
            <div className="mt-6 flex justify-center space-x-4">
              <button
                onClick={closeModals}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteAllOrders}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition"
              >
                Sí, Eliminar Todos
              </button>
            </div>
          </div>
        </CustomModal>
      )}

      {/* Modal para generar y copiar el email */}
      {isEmailModalOpen && (
        <CustomModal title="Email Diario de Pedidos" onClose={closeModals}>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Copia el siguiente contenido en un correo electrónico para enviarlo a tu equipo.
          </p>
          <div
            className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg border border-gray-300 dark:border-gray-600 overflow-auto"
            dangerouslySetInnerHTML={{ __html: emailContent }}
          />
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleCopyEmailContent}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
            >
              Copiar al Portapapeles
            </button>
          </div>
        </CustomModal>
      )}

      {isImportPreviewModalOpen && renderImportPreview()}
    </div>
  );
};

export default App;
