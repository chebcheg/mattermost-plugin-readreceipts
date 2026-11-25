import './styles/read-receipts.css';
import PostReadReceipt from './components/PostReadReceipt';
import InlineReadTicks from './components/InlineReadTicks';
import {setStore} from './store';

// Точка входа плагина.
//
// Пункт в меню поста (registerPostDropdownMenuComponent / …Action) сознательно не
// используется: в Mattermost 11 меню переехало на MUI, и плагинные пункты в нём
// не отрисовываются — ни старый компонент, ни новое действие (проверено на
// 11.11.1: фильтр вызывается, пункт в меню не появляется).
//
// Галочки рисуются в двух местах:
//   * шапка поста — первое сообщение группы (registerPostHeaderComponent);
//   * строка сообщения — остальные сообщения группы, у которых шапки нет
//     (InlineReadTicks, корневой компонент плагина).
class ReadReceiptsPlugin {
    initialize(registry, store) {
        setStore(store);

        if (typeof registry.registerPostHeaderComponent === 'function') {
            registry.registerPostHeaderComponent(PostReadReceipt);
        } else {
            // Сервер старее 11.9: хука нет, плагин будет молчать. Это лучше, чем
            // падение на инициализации.
            console.warn('[read-receipts] сервер не поддерживает registerPostHeaderComponent (нужен Mattermost 11.9+)');
        }

        if (typeof registry.registerRootComponent === 'function') {
            registry.registerRootComponent(InlineReadTicks);
        }
    }
}

window.registerPlugin('com.mattermost.plugin-readreceipts', new ReadReceiptsPlugin());
